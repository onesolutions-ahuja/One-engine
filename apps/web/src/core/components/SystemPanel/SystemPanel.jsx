/** Protected generic presentation component; actions remain in existing Flow bindings. */
export default function SystemPanel({title='Panel',description='',accentColor='#1b6586',platformSlotKey,children}) {
  // Protected Page Builder slots host their own interactive controls without
  // adding nested headings or changing legacy accessible form semantics.
  if(typeof platformSlotKey==='string'&&platformSlotKey)return <>{children}</>;
  const heading=typeof title==='string'?title:'Panel';
  const details=typeof description==='string'?description:'';
  const accent=typeof accentColor==='string'&&/^#[0-9a-fA-F]{3,8}$/.test(accentColor)?accentColor:'#1b6586';
  return <section className="metadrive-system-panel" style={{borderTopColor:accent}}>
    <h2 className="metadrive-system-panel-title">{heading}</h2>
    {details ? <p className="metadrive-system-panel-description">{details}</p> : null}
    {children}
  </section>;
}
