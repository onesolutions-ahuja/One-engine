export type StandardPageComponent = {
  apiName: string;
  label: string;
  description: string;
};

export type StandardDashboardComponent = StandardPageComponent;

export const standardPageComponents: StandardPageComponent[] = [
  { apiName: 'Accordion', label: 'Accordion', description: 'Group page content into collapsible sections.' },
  { apiName: 'Rich Text', label: 'Rich Text', description: 'Display configurable notes and readable text on a page.' },
  { apiName: 'List View', label: 'List View', description: 'Search, sort and page through authorised Object records.' },
  { apiName: 'Screen Flow', label: 'Screen Flow', description: 'Start an active Screen Flow through the shared Flow interview runtime.' },
  { apiName: 'Path', label: 'Path', description: 'Display and update the permitted current record Picklist stage.' },
  { apiName: 'Items to Approve', label: 'Items to Approve', description: 'Review and decide approvals assigned to the current user.' },
  { apiName: 'Related List Quick Links', label: 'Related List Quick Links', description: 'Jump to configured related record sections.' },
  { apiName: 'Activities', label: 'Activities', description: 'Show the record activity timeline and activity composer.' },
  { apiName: 'Chatter', label: 'Chatter', description: 'Show the record feed and collaboration tools.' },
  { apiName: 'Highlights Panel', label: 'Highlights Panel', description: 'Show key record fields and actions at the top of the page.' },
  { apiName: 'Related List', label: 'Related List', description: 'Show records related to the current record.' },
  { apiName: 'Tabs', label: 'Tabs', description: 'Organize page content into selectable tabs.' },
  { apiName: 'Record Detail', label: 'Record Detail', description: 'Show the record fields configured for the page.' },
  { apiName: 'Report Chart', label: 'Report Chart', description: 'Display a chart based on report data.' },
  { apiName: 'Dashboard', label: 'Dashboard', description: 'Embed an accessible, published dashboard with its saved widgets.' }
];

export const standardDashboardComponents: StandardDashboardComponent[] = [
  { apiName: 'Metric', label: 'Metric', description: 'Summarize a value from records or a saved report.' },
  { apiName: 'Chart', label: 'Chart', description: 'Visualize grouped data as a bar, line, donut, or funnel chart.' },
  { apiName: 'Table', label: 'Table', description: 'Show a table of record details.' }
];
