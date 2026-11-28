/** A notice about something the user must fix (not published, not saved, broken links, errors):
 * shown in red and kept until dismissed, so there is time to read and act on it. */
export const isProblemNotice=(message:string)=>
 /^(?:not |unable|cannot|can't|fix |invalid|error|failed)|broken link|not (?:saved|published)|error/i.test(message.trim());
/** How long an ordinary notice stays (ms). Problem notices stay until dismissed. */
export const NOTICE_MS=4000;
