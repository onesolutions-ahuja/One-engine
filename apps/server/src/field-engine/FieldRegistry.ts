/** One metadata registry of field-type descriptors; does not replace SQL metadata. */
import {TextDefinition} from './types/TextField.js';
import {LongTextAreaDefinition} from './types/LongTextAreaField.js';
import {RichTextDefinition} from './types/RichTextField.js';
import {EncryptedTextDefinition} from './types/EncryptedTextField.js';
import {NumberDefinition} from './types/NumberField.js';
import {CurrencyDefinition} from './types/CurrencyField.js';
import {PercentDefinition} from './types/PercentField.js';
import {DateDefinition} from './types/DateField.js';
import {DateTimeDefinition} from './types/DateTimeField.js';
import {TimeDefinition} from './types/TimeField.js';
import {CheckboxDefinition} from './types/CheckboxField.js';
import {PicklistDefinition} from './types/PicklistField.js';
import {MultiSelectPicklistDefinition} from './types/MultiSelectPicklistField.js';
import {PhoneDefinition} from './types/PhoneField.js';
import {EmailDefinition} from './types/EmailField.js';
import {UrlDefinition} from './types/UrlField.js';
import {AutoNumberDefinition} from './types/AutoNumberField.js';
import {LookupDefinition} from './types/LookupField.js';
import {MasterDetailDefinition} from './types/MasterDetailField.js';
import {RollupSummaryDefinition} from './types/RollupSummaryField.js';
import {FormulaDefinition} from './types/FormulaField.js';
import {FileDefinition} from './types/FileField.js';
import {ImageDefinition} from './types/ImageField.js';
export type FieldTypeDefinition=Readonly<{
 name:string;dataType:string|null;kind:'text'|'secure'|'numeric'|'date'|'boolean'|'selection'|'system'|'relationship'|'computed'|'attachment';
 relationshipType?:'Lookup'|'Master-Detail';storage:'record'|'file-service'|'media-service';
}>;
export const fieldDefinitions:readonly FieldTypeDefinition[]=Object.freeze([TextDefinition,LongTextAreaDefinition,RichTextDefinition,EncryptedTextDefinition,NumberDefinition,CurrencyDefinition,PercentDefinition,DateDefinition,DateTimeDefinition,TimeDefinition,CheckboxDefinition,PicklistDefinition,MultiSelectPicklistDefinition,PhoneDefinition,EmailDefinition,UrlDefinition,AutoNumberDefinition,LookupDefinition,MasterDetailDefinition,RollupSummaryDefinition,FormulaDefinition,FileDefinition,ImageDefinition]);
const byName=new Map(fieldDefinitions.map(d=>[d.name,d]));
export function getFieldType(name:string):FieldTypeDefinition|undefined{return byName.get(name);}
export function listFieldTypes():readonly FieldTypeDefinition[]{return fieldDefinitions;}
