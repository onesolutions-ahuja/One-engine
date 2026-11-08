import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { useFormFactor } from '../../workspace/Responsive/useFormFactor';
import { resolvePhoneColumns } from './phoneColumns.mjs';
import './ResponsiveDataList.css';

type Column<T> = {
  apiName: string;
  label: string;
  phoneRole?: 'title'|'subtitle'|'badge'|'trailing'|'hidden';
  render: (record: T) => React.ReactNode;
};
type Props<T> = {
  rows: readonly T[];
  columns: readonly Column<T>[];
  getId: (record: T) => string;
  label: string;
  onOpen?: (record: T) => void;
  openLabel?: string;
  loading?: boolean;
  includeTablet?: boolean;
  /** Show cards on 1024–1199px admin layouts that cannot fit their action columns. */
  includeNarrowDesktop?: boolean;
  emptyText?: string;
};
/** Phone presentation only; keep the caller's existing tablet/desktop table and operations.
 * All text comes from already-authorised caller data; permission filtering remains upstream.
 */
export default function ResponsiveDataList<T>({rows,columns,getId,label,onOpen,openLabel='Open',loading=false,emptyText='No records',includeTablet=false,includeNarrowDesktop=false}: Props<T>) {
  const formFactor=useFormFactor();
  const narrowDesktopQuery='(min-width: 1024px) and (max-width: 1199px)';
  const [isNarrowDesktop,setIsNarrowDesktop]=React.useState(()=>
    typeof window!=='undefined' && window.matchMedia(narrowDesktopQuery).matches);
  React.useEffect(()=>{
    if(!includeNarrowDesktop)return;
    const media=window.matchMedia(narrowDesktopQuery);
    const update=()=>setIsNarrowDesktop(media.matches);
    update();
    media.addEventListener('change',update);
    return ()=>media.removeEventListener('change',update);
  },[includeNarrowDesktop]);
  const roles=resolvePhoneColumns(columns);
  if(formFactor!=='Phone' && !(includeTablet && formFactor==='Tablet') && !(includeNarrowDesktop && isNarrowDesktop))return null;
  if(loading)return <div className="md-responsive-rows" role="status" aria-label={'Loading '+label}>
    {Array.from({length:5},(_,i)=><div className="md-responsive-skeleton" key={i} aria-hidden="true"><i/><i/></div>)}
  </div>;
  if(rows.length===0)return <p className="md-responsive-empty" role="status">{emptyText}</p>;
  return <div className="md-responsive-rows" role="list" aria-label={label}>
    {rows.map(record=>{
      const main=roles.title?.render(record);
      return <details className="md-responsive-item" role="listitem" key={getId(record)}>
        <summary>
          <span className="md-responsive-item-text"><strong>{main}</strong>
            {roles.subtitle&&<small>{roles.subtitle.render(record)}</small>}
            {roles.badge&&<span className="md-responsive-badge">{roles.badge.render(record)}</span>}
          </span>
          {roles.trailing&&<span className="md-responsive-trailing">{roles.trailing.render(record)}</span>}
          <ChevronRight size={18} className="md-responsive-chevron" aria-hidden="true"/>
        </summary>
        <div className="md-responsive-details">
          {columns.filter(col=>col.phoneRole!=='hidden').map(col=><div key={col.apiName}>
            <dt>{col.label}</dt><dd>{col.render(record)}</dd>
          </div>)}
          {onOpen&&<button type="button" onClick={()=>onOpen(record)}>{openLabel}</button>}
        </div>
      </details>;
    })}
  </div>;
}
