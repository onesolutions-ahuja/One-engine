import type {FieldTypeDefinition} from '../FieldRegistry.js';
/** RichTextField: richtext metadata descriptor. */
export const RichTextDefinition:FieldTypeDefinition=Object.freeze({
 name:'RichTextField',dataType:'richtext',kind:'text',
 storage:'record'
});

// Existing shared runtime implementation — preserved verbatim.
import sanitizeHtml from 'sanitize-html';

const inlineImagePath=/^\/api\/files\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/content$/i;

export function sanitizeRichText(value:string):string {
  return sanitizeHtml(value,{
    allowedTags:[...sanitizeHtml.defaults.allowedTags,'img'],
    allowedAttributes:{
      ...sanitizeHtml.defaults.allowedAttributes,
      img:['src','alt','width','height']
    },
    exclusiveFilter:frame=>frame.tag==='img'&&!inlineImagePath.test(frame.attribs.src??''),
    allowedSchemesByTag:{img:[],a:['http','https','mailto']},
    allowProtocolRelative:false
  });
}

export function isInlineImagePath(value:string):boolean {
  return inlineImagePath.test(value);
}
