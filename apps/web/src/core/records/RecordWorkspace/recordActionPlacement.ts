import type {ObjectActionMetadata} from '../../metadata/Definitions/metadata';
export type RecordActionArea='Header'|'Highlights'|'Publisher';
/** Placement is display metadata, never an authorization decision.
 * Server OneEngine Action/Record/Field/Flow checks remain mandatory. */
export function actionVisibleInArea(
 action:Pick<ObjectActionMetadata,'placement'>,area:RecordActionArea
):boolean{
 const placement=action.placement??'Default';
 if(placement==='Everywhere')return true;
 if(placement==='Default')return area!=='Publisher';
 return placement===area;
}
