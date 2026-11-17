import {Eye, Pencil, Plus, Search} from 'lucide-react';
import type {AccessControlMetadata} from '../../metadata/Definitions/metadata';

/** A User record as /api/records/User returns it (fields the actor may read). */
export type UserRecordRow = {Id: string; Name?: string; Email?: string; Enabled?: boolean; LandingApp?: string};
export type UserDetailsDraft = {Name: string; Email: string; Enabled: boolean; LandingApp: string; Password: string};

export const userDetailsFrom = (row?: UserRecordRow): UserDetailsDraft => ({
  Name: row?.Name ?? '', Email: row?.Email ?? '', Enabled: row?.Enabled ?? true,
  LandingApp: row?.LandingApp ?? 'Setup', Password: ''
});

/** One list of every tenant user: details from User records, role/profile from RBAC. */
export function UserDirectoryTable({rows, access, query, onQuery, onView, onEdit, onNew}: {
  rows: UserRecordRow[];
  access: AccessControlMetadata;
  query: string;
  onQuery: (value: string) => void;
  onView: (id: string) => void;
  onEdit: (id: string) => void;
  onNew: () => void;
}) {
  const term = query.trim().toLowerCase();
  const ids = new Set(rows.map(row => row.Id));
  // RBAC-only identities (for example system users) still appear, read from assignments.
  const merged: UserRecordRow[] = [...rows, ...access.users.filter(user => !ids.has(user.id))
    .map(user => ({Id: user.id, Name: user.name, Email: user.username}))];
  const visible = merged.filter(row => {
    const user = access.users.find(item => item.id === row.Id);
    return !term || `${row.Name ?? ''} ${row.Email ?? ''} ${user?.role ?? ''}`.toLowerCase().includes(term);
  });
  return <div className="md-user-directory">
    <div className="md-user-directory-toolbar">
      <div className="mini-search"><Search size={13}/><input aria-label="Search users" placeholder="Search users…"
        value={query} onChange={event => onQuery(event.target.value)}/></div>
      <button type="button" className="btn btn-brand" onClick={onNew}><Plus size={14}/>New User</button>
    </div>
    <div className="permission-table-wrap" role="region" aria-label="Users" tabIndex={0}>
      <table className="slds-table md-user-directory-table">
        <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th>
          <th scope="col">Profile</th><th scope="col">Status</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
        <tbody>{visible.map(row => {
          const user = access.users.find(item => item.id === row.Id);
          const role = access.roles.find(item => item.id === user?.roleId)?.name ?? user?.role ?? '';
          const profile = access.profiles.find(item => item.id === user?.profileId)?.label ?? '';
          const name = row.Name?.trim() || row.Email || 'User';
          return <tr key={row.Id}>
            <td><button type="button" className="field-link" onClick={() => onView(row.Id)}><strong>{name}</strong></button></td>
            <td>{row.Email ?? ''}</td><td>{role || '—'}</td><td>{profile || '—'}</td>
            <td>{row.Enabled === undefined ? '—' : row.Enabled
              ? <span className="md-user-status is-active">Active</span>
              : <span className="md-user-status">Inactive</span>}</td>
            <td className="md-user-directory-actions">
              <button type="button" className="icon-button subtle" aria-label={'View ' + name} title="View"
                onClick={() => onView(row.Id)}><Eye size={15}/></button>
              <button type="button" className="icon-button subtle" aria-label={'Edit ' + name} title="Edit"
                onClick={() => onEdit(row.Id)}><Pencil size={15}/></button>
            </td>
          </tr>;
        })}
        {!visible.length && <tr><td colSpan={6} className="empty-state">No users found.</td></tr>}</tbody>
      </table>
    </div>
  </div>;
}

/** Name, email, status and landing app: the User record part of the one user form. */
export function UserDetailsFields({value, creating, editing, apps, onChange}: {
  value: UserDetailsDraft;
  creating: boolean;
  editing: boolean;
  apps: Array<{apiName: string; label: string}>;
  onChange: (next: UserDetailsDraft) => void;
}) {
  const set = <K extends keyof UserDetailsDraft>(key: K, next: UserDetailsDraft[K]) => onChange({...value, [key]: next});
  return <fieldset className="md-user-details-grid" disabled={!editing}>
    <label className="form-label">Name<input className="form-control" value={value.Name}
      onChange={event => set('Name', event.target.value)}/></label>
    <label className="form-label">Email<input className="form-control" type="email" value={value.Email} required
      onChange={event => set('Email', event.target.value)}/></label>
    {creating && <label className="form-label">Initial password<input className="form-control" type="password" required
      autoComplete="new-password" value={value.Password} onChange={event => set('Password', event.target.value)}/></label>}
    <label className="form-label">Landing app<select className="form-control" value={value.LandingApp}
      onChange={event => set('LandingApp', event.target.value)}>
      <option value="Setup">Setup</option>
      {apps.map(app => <option key={app.apiName} value={app.apiName}>{app.label}</option>)}
    </select></label>
    <label className="checkbox-row md-user-active"><input type="checkbox" checked={value.Enabled}
      onChange={event => set('Enabled', event.target.checked)}/>Active</label>
  </fieldset>;
}
