import type {FieldMetadata} from '../../metadata/Definitions/metadata';

/** A plain Text field may hold an image reference (legacy "Image URL", "Category Image", logos).
 * Only those fields offer the tenant image picker in record forms; ordinary text such as
 * Name, SKU or Description must not. Dedicated Image/File fields use their own media control. */
const imageTextFieldPattern=/(image|logo|photo|picture|icon|thumbnail|avatar)/i;

export function acceptsTenantImageAsset(field:Pick<FieldMetadata,'apiName'|'label'|'dataType'>):boolean{
  if(!/^(text|url)\b/i.test(field.dataType??''))return false;
  return imageTextFieldPattern.test(field.apiName)||imageTextFieldPattern.test(field.label??'');
}
