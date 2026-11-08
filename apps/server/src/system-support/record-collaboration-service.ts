import type {SqlPersistence} from '../system-files/sql-persistence.js';
import type {RbacEngine} from '../system-files/rbac-engine.js';
const validId=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validObject=/^[A-Za-z][A-Za-z0-9_]*$/;
type Identity={tenant_id:string;user_id:string};
type Activity={id:string;object_api:string;record_id:string;kind:string;subject:string;description:string;status:string;due_at:Date|null;created_by:string;created_by_name:string;created_at:Date};
type Post={id:string;object_api:string;record_id:string;body:string;created_by:string;created_by_name:string;created_at:Date};
type Comment={id:string;post_id:string;body:string;created_by:string;created_by_name:string;created_at:Date};
const activityView=(r:Activity)=>({id:r.id,objectApiName:r.object_api,recordId:r.record_id,
 kind:r.kind,subject:r.subject,description:r.description,status:r.status,
 dueAt:r.due_at?new Date(r.due_at).toISOString():null,
 createdBy:r.created_by,createdByName:r.created_by_name,
 createdAt:new Date(r.created_at).toISOString()});
const commentView=(r:Comment)=>({id:r.id,body:r.body,createdBy:r.created_by,
 createdByName:r.created_by_name,createdAt:new Date(r.created_at).toISOString()});
export class RecordCollaborationService {
 constructor(private readonly db:SqlPersistence,private readonly rbac:RbacEngine){}
 private async guard(actor:Identity,objectApi:string,recordId:string,action:'read'|'edit',feature:'activities'|'chatter'){
  if(!validObject.test(objectApi)||!validId.test(recordId))throw new Error('Invalid record reference');
  await this.rbac.require(actor.tenant_id,actor.user_id,objectApi,action);
  await this.rbac.requireRecord(actor.tenant_id,actor.user_id,objectApi,recordId,action);
  const result=await this.db.query('SELECT id FROM md_records WHERE tenant_id=$1 AND object_api=$2 AND id=$3 AND is_deleted=false',
   [actor.tenant_id,objectApi,recordId]);
  if(!result.rowCount)throw new Error('Record not found');
  // Tenant metadata can disable these functions independently of OneEngine RBAC.
  // Objects without migrated settings retain legacy behaviour until configured.
  const configuration=await this.db.query<{allow_activities:boolean|null;allow_in_chatter:boolean|null}>(`
    SELECT settings.allow_activities,settings.allow_in_chatter
    FROM md_object_definitions object
    LEFT JOIN md_object_manager_settings settings
      ON settings.tenant_id=object.tenant_id AND settings.object_api=object.api_name
    WHERE object.tenant_id=$1 AND object.api_name=$2`,
    [actor.tenant_id,objectApi]);
  const flag=feature==='activities'?'allow_activities':'allow_in_chatter';
  if(configuration.rows[0]?.[flag]===false)
    throw new Error(feature==='activities'?'Activities are disabled for this object':'Chatter is disabled for this object');
 }
 private async activities(actor:Identity,objectApi:string,recordId:string,id?:string){
  const {rows}=await this.db.query<Activity>(`
   SELECT a.*,COALESCE(NULLIF(u.display_name,''),u.email) AS created_by_name
   FROM md_record_activities a JOIN md_users u ON u.tenant_id=a.tenant_id AND u.id=a.created_by
   WHERE a.tenant_id=$1 AND a.object_api=$2 AND a.record_id=$3
   ${id?'AND a.id=$4':''} ORDER BY a.created_at DESC,a.id DESC LIMIT 100`,
   id?[actor.tenant_id,objectApi,recordId,id]:[actor.tenant_id,objectApi,recordId]);
  return rows;
 }
 async listActivities(actor:Identity,objectApi:string,recordId:string){
  await this.guard(actor,objectApi,recordId,'read','activities');
  return {activities:(await this.activities(actor,objectApi,recordId)).map(activityView)};
 }
 async addActivity(actor:Identity,objectApi:string,recordId:string,data:unknown){
  await this.guard(actor,objectApi,recordId,'edit','activities');
  if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Invalid activity');
  const {kind,subject,description='',status='Open',dueAt=null}=data as Record<string,unknown>;
  if(!['Task','Call','Event'].includes(String(kind))||typeof subject!=='string'||
   !subject.trim()||subject.length>200||typeof description!=='string'||description.length>10000||
   !['Open','Completed'].includes(String(status))||
   (dueAt!==null&&(typeof dueAt!=='string'||!Number.isFinite(Date.parse(dueAt)))))
   throw new Error('Invalid activity');
  const {rows}=await this.db.query<{id:string}>(`
   INSERT INTO md_record_activities(tenant_id,object_api,record_id,created_by,kind,subject,description,status,due_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
   [actor.tenant_id,objectApi,recordId,actor.user_id,kind,subject.trim(),description,status,dueAt]);
  return {activity:activityView((await this.activities(actor,objectApi,recordId,rows[0].id))[0])};
 }
 async updateActivity(actor:Identity,objectApi:string,recordId:string,id:string,status:unknown){
  await this.guard(actor,objectApi,recordId,'edit','activities');
  if(!validId.test(id)||!['Open','Completed'].includes(String(status)))throw new Error('Invalid activity update');
  const {rowCount}=await this.db.query(
   'UPDATE md_record_activities SET status=$5 WHERE tenant_id=$1 AND object_api=$2 AND record_id=$3 AND id=$4',
   [actor.tenant_id,objectApi,recordId,id,status]);
  if(!rowCount)throw new Error('Activity not found');
  return {activity:activityView((await this.activities(actor,objectApi,recordId,id))[0])};
 }
 private async posts(actor:Identity,objectApi:string,recordId:string,postId?:string){
  const {rows}=await this.db.query<Post>(`
    SELECT p.*,COALESCE(NULLIF(u.display_name,''),u.email) AS created_by_name
    FROM md_record_chatter_posts p JOIN md_users u ON u.tenant_id=p.tenant_id AND u.id=p.created_by
    WHERE p.tenant_id=$1 AND p.object_api=$2 AND p.record_id=$3
    ${postId?'AND p.id=$4':''} ORDER BY p.created_at DESC,p.id DESC LIMIT 100`,
    postId?[actor.tenant_id,objectApi,recordId,postId]:[actor.tenant_id,objectApi,recordId]);
  if(!rows.length)return [];
  const comments=await this.db.query<Comment>(`
    SELECT c.*,COALESCE(NULLIF(u.display_name,''),u.email) AS created_by_name
    FROM md_record_chatter_comments c JOIN md_users u ON u.tenant_id=c.tenant_id AND u.id=c.created_by
    WHERE c.tenant_id=$1 AND c.post_id=ANY($2::uuid[])
    ORDER BY c.created_at,c.id LIMIT 10000`,
    [actor.tenant_id,rows.map(r=>r.id)]);
  const byPost=new Map<string,ReturnType<typeof commentView>[]>();
  for(const item of comments.rows){
    const group=byPost.get(item.post_id)??[];
    if(group.length<100)group.push(commentView(item));
    byPost.set(item.post_id,group);
  }
  return rows.map(post=>({id:post.id,objectApiName:post.object_api,recordId:post.record_id,body:post.body,
    createdBy:post.created_by,createdByName:post.created_by_name,
    createdAt:new Date(post.created_at).toISOString(),comments:byPost.get(post.id)??[]}));

 }
 async listPosts(actor:Identity,objectApi:string,recordId:string){
  await this.guard(actor,objectApi,recordId,'read','chatter');
  return {posts:await this.posts(actor,objectApi,recordId)};
 }
 async addPost(actor:Identity,objectApi:string,recordId:string,body:unknown){
  await this.guard(actor,objectApi,recordId,'edit','chatter');
  if(typeof body!=='string'||!body.trim()||body.length>10000)throw new Error('Invalid Chatter post');
  const {rows}=await this.db.query<{id:string}>(`
   INSERT INTO md_record_chatter_posts(tenant_id,object_api,record_id,created_by,body)
   VALUES($1,$2,$3,$4,$5) RETURNING id`,[actor.tenant_id,objectApi,recordId,actor.user_id,body.trim()]);
  return {post:(await this.posts(actor,objectApi,recordId,rows[0].id))[0]};
 }
 async addComment(actor:Identity,objectApi:string,recordId:string,postId:string,body:unknown){
  await this.guard(actor,objectApi,recordId,'edit','chatter');
  if(!validId.test(postId)||typeof body!=='string'||!body.trim()||body.length>10000)
   throw new Error('Invalid Chatter comment');
  const post=await this.db.query('SELECT id FROM md_record_chatter_posts WHERE tenant_id=$1 AND object_api=$2 AND record_id=$3 AND id=$4',
   [actor.tenant_id,objectApi,recordId,postId]);
  if(!post.rowCount)throw new Error('Chatter post not found');
  await this.db.query(`
   INSERT INTO md_record_chatter_comments(tenant_id,post_id,created_by,body) VALUES($1,$2,$3,$4)`,
   [actor.tenant_id,postId,actor.user_id,body.trim()]);
  return {post:(await this.posts(actor,objectApi,recordId,postId))[0]};
 }
}
