import type { ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import './SettingsViewRow.css';

/** Shared read-first Settings primitive; callers enforce the matching server-side permission. */
export default function SettingsViewRow({
  label, value, canEdit = false, onEdit, children
}: {
  label: string;
  value: ReactNode;
  canEdit?: boolean;
  onEdit?: () => void;
  children?: ReactNode;
}) {
  return <div className="settings-view-row">
    <div className="settings-view-row-content">
      <span className="settings-view-row-label">{label}</span>
      <span className="settings-view-row-value">{value === '' || value == null ? '—' : value}</span>
      {children}
    </div>
    {canEdit && onEdit && <button type="button" className="settings-view-pencil"
      aria-label={`Edit ${label}`} title={`Edit ${label}`} onClick={onEdit}>
      <Pencil size={16} aria-hidden="true" />
    </button>}
  </div>;
}
