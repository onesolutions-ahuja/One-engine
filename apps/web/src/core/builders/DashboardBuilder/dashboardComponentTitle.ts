export function sourceReportTitleUpdate(
  currentTitle: string,
  defaultTitle: string,
  previousReportTitle: string | undefined,
  nextReportTitle: string | undefined
): string | undefined {
  const followsSource = currentTitle === defaultTitle || currentTitle === previousReportTitle;
  if (!followsSource) return undefined;
  return nextReportTitle ?? defaultTitle;
}
