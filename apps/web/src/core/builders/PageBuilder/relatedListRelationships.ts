import type { ObjectMetadata } from '../../metadata/Definitions/metadata';

/** Enumerate relationships once for Builder menus; callers retain their own display and deduplication rules. */
export function relatedListRelationships(objects: ObjectMetadata[], targetObjectApiName: string) {
  return objects.flatMap((childObject) => childObject.fields.flatMap((field) =>
    field.relationship?.targetObject === targetObjectApiName
      ? [{ childRelationshipName: field.relationship.childRelationshipName, pluralLabel: childObject.pluralLabel }]
      : []
  ));
}
