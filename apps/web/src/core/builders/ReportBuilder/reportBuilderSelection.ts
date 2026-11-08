import type { ReportMetadata } from '../../metadata/Definitions/metadata';

/** Clone editable report fields without mutating the SQL-backed metadata snapshot. */
export function cloneReportForEditing(report: ReportMetadata): ReportMetadata {
  return {
    ...report,
    fieldApiNames: [...report.fieldApiNames],
    groupByFieldApiNames: [...report.groupByFieldApiNames],
    filters: report.filters.map(filter => ({...filter, values:[...filter.values]})),
    standardFilters: {...report.standardFilters},
    crossFilters: report.crossFilters.map(filter => ({
      ...filter,
      filters: filter.filters.map(subfilter => ({...subfilter, values:[...subfilter.values]}))
    })),
    rowLimit: {...report.rowLimit}
  };
}
