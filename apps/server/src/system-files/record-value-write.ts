/** Shared normalized field payload; writes go through native-values.ts. */
export type RecordStoredValue={value_text:string|null;reference_record_id:string|null;
 value_number?:string|null;value_date?:string|null;value_datetime?:Date|null;value_boolean?:boolean|null;
 geo_latitude?:number|null;geo_longitude?:number|null;address_street?:string|null;address_city?:string|null;
 address_state?:string|null;address_postal_code?:string|null;address_country?:string|null;
 multi_values?:string[];is_unique:boolean;case_sensitive:boolean};
