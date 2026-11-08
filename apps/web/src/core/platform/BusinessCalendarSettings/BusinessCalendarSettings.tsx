import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Pencil, RefreshCw, X } from 'lucide-react';
import './BusinessCalendarSettings.css';

type Day = { closed: boolean; open: string; close: string };
type BusinessCalendar = {
  fiscalYearStart: { month: number; day: number };
  timezone: string;
  weeklyHours: Record<string, Day>;
  holidays: Array<{ date: string; label: string }>;
};
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
const weekdays = [
  ['monday', 'Monday'], ['tuesday', 'Tuesday'], ['wednesday', 'Wednesday'],
  ['thursday', 'Thursday'], ['friday', 'Friday'], ['saturday', 'Saturday'],
  ['sunday', 'Sunday']
] as const;
const timeZoneOptions = Array.from(new Set([
  'Europe/London',
  'UTC',
  ...(typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : ['Europe/London'])
])).sort((left, right) => {
  if (left === 'Europe/London') return -1;
  if (right === 'Europe/London') return 1;
  if (left === 'UTC') return -1;
  if (right === 'UTC') return 1;
  return left.localeCompare(right);
});
const timeOptions = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2);
  const minute = index % 2 ? '30' : '00';
  const period = hour < 12 ? 'AM' : 'PM';
  return `${hour % 12 || 12}:${minute} ${period}`;
});
const formatTime = (value: string) => {
  if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(value)) return '';
  const [hour, minute] = value.split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
};
const parseTime = (value: string) => {
  const match = /^(\d{1,2}):([0-5]\d)\s*(AM|PM)?$/i.exec(value.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  if (match[3]) {
    if (hour < 1 || hour > 12) return null;
    hour = hour % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0);
  } else if (hour > 23) return null;
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
};
const timePattern = '(?:0?[1-9]|1[0-2]):[0-5][0-9]\\s*[AaPp][Mm]|(?:[01]?[0-9]|2[0-3]):[0-5][0-9]';
const businessCalendarFailure=(cause:unknown,fallback:string):string=>{
  const message=cause instanceof Error?cause.message:fallback;
  return /SQL|database|postgres|non-JSON|HTTP 50[0234]|upstream|relation .+ does not exist/i.test(message)
    ?'Business calendar service is temporarily unavailable. Please retry.':message;
};
const suggestedCalendar = (): BusinessCalendar => ({
  fiscalYearStart: { month: 4, day: 6 },
  timezone: 'Europe/London',
  weeklyHours: Object.fromEntries(weekdays.map(([day]) =>
    [day, {
      closed: day === 'saturday' || day === 'sunday',
      open: '09:00',
      close: '17:00'
    }])) as Record<string, Day>,
  holidays: []
});

function BusinessHoursTime({ day, label, value, disabled, onChange }: {
  day: string;
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(() => formatTime(value));
  const lastValue = useRef(value);
  useEffect(() => {
    if (lastValue.current === value) return;
    lastValue.current = value;
    if (!value) return;
    if (parseTime(draft) !== value) setDraft(formatTime(value));
  }, [draft, value]);
  return <label className="business-calendar-time-field">{label}
    <input type="text" list="business-calendar-time-options" inputMode="text"
      pattern={timePattern} title="Enter a time such as 9:00 AM or 09:31."
      required={!disabled} disabled={disabled} value={draft}
      aria-label={`${day} ${label.toLowerCase()}`}
      onChange={event => {
        const next = event.target.value;
        setDraft(next);
        const parsed = parseTime(next);
        onChange(parsed ?? '');
      }} />
  </label>;
}

export default function BusinessCalendarSettings({ request, permitted }: {
  request: Request;
  permitted: boolean;
}) {
  const [calendar, setCalendar] = useState(suggestedCalendar);
  const [savedCalendar, setSavedCalendar] = useState<BusinessCalendar | null>(null);
  const [configured, setConfigured] = useState(false);
  const [editing, setEditing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [holidayDate, setHolidayDate] = useState('');
  const [holidayLabel, setHolidayLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!permitted) return;
    let active = true;
    setLoading(true);
    setLoaded(false);
    setError('');
    setNotice('');
    void request<{ calendar: BusinessCalendar | null }>('/tenant/business-calendar', {cache:'no-store'})
      .then(({ calendar: saved }) => {
        if (active) {
          const next = saved ?? suggestedCalendar();
          setCalendar(next);
          setSavedCalendar(saved);
          setConfigured(Boolean(saved));
          // When nothing has been saved, show the editable timetable with its own
          // Save button immediately. Never present suggested hours as saved.
          setEditing(saved === null);
          setLoaded(true);
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(businessCalendarFailure(cause,'Unable to load business calendar'));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [request, permitted, revision]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const invalidDay = weekdays.find(([day]) => {
      const hours = calendar.weeklyHours[day];
      const open = parseTime(hours.open);
      const close = parseTime(hours.close);
      return !hours.closed && (!open || !close || open >= close);
    });
    const fiscalMaxDay = calendar.fiscalYearStart.month >= 1 && calendar.fiscalYearStart.month <= 12
      ? new Date(Date.UTC(2000, calendar.fiscalYearStart.month, 0)).getUTCDate()
      : 0;
    if (!calendar.fiscalYearStart.month || calendar.fiscalYearStart.day < 1 ||
      calendar.fiscalYearStart.day > fiscalMaxDay) {
      setError('Enter a valid fiscal year start date.');
      return;
    }
    if (!calendar.timezone.trim() || invalidDay) {
      setError(invalidDay
        ? `Enter valid opening and closing times for ${invalidDay[1]}; the closing time must be later.`
        : 'Choose an organization time zone before saving.');
      return;
    }
    const normalizedCalendar: BusinessCalendar = {
      ...calendar,
      weeklyHours: Object.fromEntries(weekdays.map(([day]) => {
        const hours = calendar.weeklyHours[day];
        return [day, {
          ...hours,
          open: parseTime(hours.open) ?? (hours.closed ? '09:00' : ''),
          close: parseTime(hours.close) ?? (hours.closed ? '17:00' : '')
        }];
      }))
    };
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await request<{ calendar: BusinessCalendar }>('/tenant/business-calendar', {
        method: 'PUT', body: JSON.stringify(normalizedCalendar)
      });
      // A successful PUT is not enough: calendar clients consume these settings through GET.
      // Only show a save confirmation after a fresh read returns the saved hours.
      if (!result?.calendar) throw new Error('Server did not confirm the business-hours save.');
      const readback = await request<{calendar:BusinessCalendar|null}>('/tenant/business-calendar', {cache:'no-store'});
      const verified = readback.calendar;
      if (!verified) throw new Error('Save succeeded but the business calendar could not be read back.');
      // Compare with the server's canonical response (which sorts holidays).
      if (verified.timezone !== result.calendar.timezone ||
          verified.fiscalYearStart.month !== result.calendar.fiscalYearStart.month ||
          verified.fiscalYearStart.day !== result.calendar.fiscalYearStart.day ||
          weekdays.some(([day]) =>
            verified.weeklyHours[day]?.closed !== result.calendar.weeklyHours[day].closed ||
            verified.weeklyHours[day]?.open !== result.calendar.weeklyHours[day].open ||
            verified.weeklyHours[day]?.close !== result.calendar.weeklyHours[day].close) ||
          JSON.stringify(verified.holidays) !== JSON.stringify(result.calendar.holidays))
        throw new Error('Saved calendar differs from the requested business hours, holidays or fiscal settings.');
      setCalendar(verified);
      setSavedCalendar(verified);
      setConfigured(true);
      setEditing(false);
      setNotice('Business hours saved and verified in this tenant. Ace Assist will use these hours.');
      // A running calendar in this browser can re-read the new tenant setting.
      window.dispatchEvent(new Event('metadrive:business-calendar-saved'));
    } catch (cause) {
      setError(businessCalendarFailure(cause,'Unable to save business calendar'));
    } finally { setSaving(false); }
  };

  const cancelEdit = () => {
    setCalendar(savedCalendar ?? suggestedCalendar());
    setEditing(false);
    setError('');
    setNotice('');
  };

  if (!permitted) return null;
  return <section className="business-calendar surface permission-section" aria-label="Business calendar">
    <header><div><h2>Fiscal year, business hours &amp; holidays</h2>
      <p>Shared organization calendar settings for scheduling, escalation and entitlement rules.</p></div>
      <div className="business-calendar-actions">
        {!editing && <button type="button" className="btn" disabled={loading || !loaded}
          onClick={() => { setEditing(true); setError(''); setNotice(''); }}>
          <Pencil size={14} /> Edit
        </button>}
        {!editing && <button type="button" className="btn" disabled={loading}
          onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} /> Refresh</button>}
        {editing && <button type="submit" form="business-calendar-form" className="btn btn-primary"
          disabled={saving || loading || !loaded}>
          <Check size={14} /> {saving ? 'Saving…' : 'Save business hours'}
        </button>}
      </div>
    </header>
    {loading && <p role="status">Loading business calendar…</p>}
    {!loading&&!loaded&&<button type="button" className="btn" onClick={()=>setRevision(value=>value+1)}>Retry loading business calendar</button>}
    {error && <p className="business-calendar-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!loading && loaded && !configured &&
      <p role="status" className="business-calendar-unsaved">
        No business hours have been saved for this organisation.
        The times shown below are suggestions only. Select <strong>Save business hours</strong>
        to store them for Ace Assist.
      </p>}
    <form noValidate onSubmit={(event) => void save(event)} id="business-calendar-form">
      <div className="business-calendar-options">
        <label>Fiscal year starts
          {editing ? <span><select required aria-label="Fiscal year start month" value={calendar.fiscalYearStart.month}
            onChange={event => setCalendar(value => ({ ...value, fiscalYearStart: {
              ...value.fiscalYearStart, month: Number(event.target.value)
            } }))}>
            {Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>
              {new Date(2000, index, 1).toLocaleString(undefined, { month: 'long' })}
            </option>)}
          </select>
          <input aria-label="Fiscal year start day" type="number" min={1} max={31} required
            value={calendar.fiscalYearStart.day} onChange={event => setCalendar(value => ({
              ...value, fiscalYearStart: { ...value.fiscalYearStart, day: Number(event.target.value) }
            }))} /></span>
            : <strong className="business-calendar-readonly-value">
              {calendar.fiscalYearStart.day} {new Date(2000, calendar.fiscalYearStart.month - 1, 1)
                .toLocaleString(undefined, { month: 'long' })}
            </strong>}
        </label>
        <label>Organization time zone
          {editing ? <select required value={calendar.timezone}
              onChange={event => setCalendar(value => ({ ...value, timezone: event.target.value }))}>
              {!timeZoneOptions.includes(calendar.timezone) && calendar.timezone &&
                <option value={calendar.timezone}>{calendar.timezone}</option>}
              {timeZoneOptions.map(timeZone => <option key={timeZone} value={timeZone}>{timeZone}</option>)}
            </select>
            : <strong className="business-calendar-readonly-value">{calendar.timezone}</strong>}
        </label>
      </div>
      <div className="business-calendar-hours-heading">
        <div><h3>Weekly business hours</h3><p>Choose from 30-minute suggestions or type a custom time.</p></div>
        {editing && <button type="button" className="btn" disabled={saving || loading}
          onClick={() => setCalendar(value => ({
            ...value,
            weeklyHours: Object.fromEntries(weekdays.map(([day]) => [
              day, { ...value.weeklyHours.monday }
            ])) as Record<string, Day>
          }))}>Copy Monday hours to all days</button>}
      </div>
      <div className="business-calendar-days">
        {weekdays.map(([day, label]) => <div className="business-calendar-day" key={day}>
          <strong>{label}</strong>
          {editing ? <><label className="business-calendar-closed"><input type="checkbox" checked={calendar.weeklyHours[day].closed}
            onChange={event => setCalendar(value => ({ ...value, weeklyHours: {
              ...value.weeklyHours, [day]: { ...value.weeklyHours[day], closed: event.target.checked }
            } }))} /> Closed</label>
          <BusinessHoursTime day={label} label="Opens" value={calendar.weeklyHours[day].open}
            disabled={calendar.weeklyHours[day].closed}
            onChange={open => setCalendar(value => ({ ...value, weeklyHours: {
              ...value.weeklyHours, [day]: { ...value.weeklyHours[day], open }
            } }))} />
          <span className="business-calendar-time-separator" aria-hidden="true">to</span>
          <BusinessHoursTime day={label} label="Closes" value={calendar.weeklyHours[day].close}
            disabled={calendar.weeklyHours[day].closed}
            onChange={close => setCalendar(value => ({ ...value, weeklyHours: {
              ...value.weeklyHours, [day]: { ...value.weeklyHours[day], close }
            } }))} /></>
            : <span className="business-calendar-readonly-hours">
              {calendar.weeklyHours[day].closed ? 'Closed'
                : `${formatTime(calendar.weeklyHours[day].open)} – ${formatTime(calendar.weeklyHours[day].close)}`}
            </span>}
        </div>)}
        {editing && <datalist id="business-calendar-time-options">
          {timeOptions.map(time => <option key={time} value={time} />)}
        </datalist>}
      </div>
      <h3>Holidays</h3>
      {editing && <div className="business-calendar-holiday-entry">
        <label>Date <input type="date" value={holidayDate} onChange={event => setHolidayDate(event.target.value)} /></label>
        <label>Name <input value={holidayLabel} maxLength={120} onChange={event => setHolidayLabel(event.target.value)} /></label>
        <button type="button" className="btn" disabled={!holidayDate || !holidayLabel.trim() || calendar.holidays.length >= 500}
          onClick={() => {
            if (calendar.holidays.some(item => item.date === holidayDate)) {
              setError('A holiday is already configured for that date.');
              return;
            }
            setCalendar(value => ({ ...value, holidays: [...value.holidays,
              { date: holidayDate, label: holidayLabel.trim() }].sort((a, b) => a.date.localeCompare(b.date)) }));
            setHolidayDate(''); setHolidayLabel(''); setError('');
          }}>Add holiday</button>
      </div>}
      {calendar.holidays.length > 0 && <ul className="business-calendar-holidays">
        {calendar.holidays.map(holiday => <li key={holiday.date}>
          <span><strong>{holiday.date}</strong> {holiday.label}</span>
          {editing && <button type="button" className="btn" aria-label={'Remove ' + holiday.label}
            onClick={() => setCalendar(value => ({ ...value,
              holidays: value.holidays.filter(item => item.date !== holiday.date) }))}>Remove</button>}
        </li>)}
      </ul>}
      {!editing && !calendar.holidays.length && <p className="business-calendar-empty-holidays">No holidays configured.</p>}
      {editing && <div className="business-calendar-form-actions">
        <button type="button" className="btn" disabled={saving} onClick={cancelEdit}>
          <X size={14} /> Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving || loading}>
          <Check size={14} /> {saving ? 'Saving business hours…' : 'Save business hours'}
        </button>
      </div>}
    </form>
  </section>;
}
