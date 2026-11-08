import { useEffect,useState, type FormEvent, type CSSProperties } from 'react';
import { readSubmittedLogin } from './readSubmittedLogin';
import type { ObjectMetadata, LightningPageMetadata, LightningAppMetadata } from '../../metadata/Definitions/metadata';
import { apiRequest, setAccessToken } from '../Client/authClient';
import LoginRecovery from './LoginRecovery';
import { UneBrandLogo } from '../../branding/UneBrandLogo';
import { Eye, EyeOff } from 'lucide-react';
import './standaloneLogin.css';

declare const __METADRIVE_WEB_RELEASE__: {commit:string|null;builtAt:string};
type LandingBootstrap = {
  objects: ObjectMetadata[];
  pages: LightningPageMetadata[];
  apps: LightningAppMetadata[];
  user: {
    profileId: string;
    permissions: string[];
    fieldAccess: Record<string, { read: boolean; edit: boolean }>;
    recordTypeAccess: Record<string, boolean>;
  };
};
type EntryTiming = { kind: 'login' | 'restore'; startedAt: number; authenticatedAt: number; landing?: LandingBootstrap; landingAppApi?: string };
type LoginResult={access_token?:string;landing?:LandingBootstrap;landingAppApi?:string;mfa_required?:boolean;challenge_token?:string;setup_secret?:string;enrollment_required?:boolean};
let federationCompletion:Promise<LoginResult|undefined>|undefined;

export type ProductLoginBrand = { label: string; eyebrow: string; tagline: string; accent: string; signInDescription: string };

export function createLoginView(logoUrl: string) {
  function Login({ error, onStart, onSuccess, onRetry, branding }: {
    error?: string;
    onStart?: () => void;
    onSuccess?: (timing: EntryTiming) => void;
    onRetry?: () => void;
    branding?: ProductLoginBrand;
  }) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [passwordVisible, setPasswordVisible] = useState(false);
    const [message, setMessage] = useState(error ?? '');
    const [fieldErrors, setFieldErrors] = useState<{email?:string;password?:string;code?:string}>({});
    const [submitting, setSubmitting] = useState(false);
    const [mailAdminLogin] = useState(() => {
      try { return window.sessionStorage.getItem('md_auth_return_to') === '/mail-admin'; }
      catch { return false; }
    });
    const [challenge,setChallenge]=useState<{challenge_token:string;setup_secret?:string;enrollment_required?:boolean}|null>(null);
    const [code,setCode]=useState('');
    const [providers,setProviders]=useState<Array<{id:string;label:string}>>([]);
    const [recovering,setRecovering]=useState(()=>{
      const query=new URLSearchParams(window.location.search);
      return query.has('resetToken')||query.get('recover')==='1';
    });
    useEffect(()=>{
      const sync=()=>{const query=new URLSearchParams(window.location.search);setRecovering(query.get('recover')==='1'||query.has('resetToken'));};
      window.addEventListener('popstate',sync);
      return ()=>window.removeEventListener('popstate',sync);
    },[]);
    useEffect(()=>{document.title=recovering?'Recover your password | Une Solutions':'Sign in | Une Solutions';},[recovering]);
    const openRecovery=()=>{
      const url=new URL(window.location.href);url.searchParams.set('recover','1');
      window.history.pushState(null,'',url.pathname+url.search+url.hash);
      setPasswordVisible(false);setPassword('');setFieldErrors({});setRecovering(true);
    };
    const closeRecovery=()=>{
      const url=new URL(window.location.href);
      url.searchParams.delete('recover');url.searchParams.delete('resetToken');url.searchParams.delete('resetEmail');
      window.history.pushState(null,'',url.pathname+url.search+url.hash);
      setPasswordVisible(false);setPassword('');setFieldErrors({});setMessage('');setRecovering(false);
    };
    const accept=(session:{access_token?:string;landing?:LandingBootstrap;landingAppApi?:string;mfa_required?:boolean;challenge_token?:string;setup_secret?:string;enrollment_required?:boolean},startedAt:number)=>{
      if(session.mfa_required&&session.challenge_token){setPassword('');setChallenge({...session,challenge_token:session.challenge_token});return;}
      if(!session.access_token)throw Error('Authentication did not return an access token');
      setAccessToken(session.access_token);onSuccess?.({kind:'login',startedAt,authenticatedAt:performance.now(),landing:session.landing,landingAppApi:session.landingAppApi});
    };
    useEffect(()=>{
      let active=true;
      void apiRequest<{providers:Array<{id:string;label:string}>}>('/auth/federation/providers').then(r=>{if(active)setProviders(r.providers);}).catch(()=>{});
      const startedAt=performance.now();
      federationCompletion??=apiRequest<LoginResult|undefined>('/auth/federation/complete',{method:'POST'}).finally(()=>{federationCompletion=undefined;});
      void federationCompletion.then(r=>{if(active&&r)accept(r,startedAt);}).catch(e=>{if(active)setMessage(e instanceof Error?e.message:String(e));});
      return()=>{active=false;};
    },[]);
    const passkey=async()=>{
      if(!challenge)return;setSubmitting(true);setMessage('');
      try{
        const {startAuthentication}=await import('@simplewebauthn/browser');
        const request=await apiRequest<{options:Parameters<typeof startAuthentication>[0]['optionsJSON'];token:string}>('/auth/passkeys/options',{method:'POST',body:JSON.stringify({challenge_token:challenge.challenge_token})});
        const response=await startAuthentication({optionsJSON:request.options});
        accept(await apiRequest('/auth/passkeys/verify',{method:'POST',body:JSON.stringify({token:request.token,response})}),performance.now());
      }catch(e){setMessage(e instanceof Error?e.message:String(e));}finally{setSubmitting(false);}
    };

    const signIn = async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const { email: submittedEmail, password: submittedPassword } = challenge?{email:'',password:''}:readSubmittedLogin(new FormData(event.currentTarget));
      onStart?.();
      const startedAt = performance.now();
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 10000);
      setSubmitting(true);
      setMessage('');
      try {
        const session = await apiRequest<{
          access_token?: string;
          landing?: LandingBootstrap;
          landingAppApi?: string;
          mfa_required?: boolean;
          challenge_token?:string;setup_secret?:string;enrollment_required?:boolean;
        }>(challenge?'/auth/mfa/verify?landing=1':'/auth/login?landing=1', {
          method: 'POST',
          signal: controller.signal,
          body: JSON.stringify(challenge?{challenge_token:challenge.challenge_token,code}:{ email: submittedEmail, password: submittedPassword })
        });
        accept(session,startedAt);
      } catch (failure) {
        setMessage(failure instanceof DOMException && failure.name === 'AbortError'
          ? 'Login timed out. The workspace API is unavailable. Please retry.'
          : failure instanceof TypeError
            ? 'Cannot connect to the workspace API. Please retry when the service is online.'
            : failure instanceof Error ? failure.message : 'Unable to sign in');
        // Put focus back on the actionable field for invalid credentials.
        // Connection errors retain focus on the submit/retry action.
        if (!(failure instanceof DOMException && failure.name==='AbortError') &&
            !(failure instanceof TypeError)) {
          window.requestAnimationFrame(()=>{
            document.getElementById(challenge?'login-mfa':'login-email')?.focus();
          });
        }
      } finally {
        window.clearTimeout(timeout);
        setSubmitting(false);
      }
    };

    const loginStyle=branding?{'--standalone-accent':branding.accent} as CSSProperties:undefined;
    if(recovering)return <main className={branding?'auth-screen auth-screen--standalone':'auth-screen'} style={loginStyle}><div className="auth-card">
      {!branding && <UneBrandLogo className="auth-brand-logo" src={logoUrl} />}
      <div className="eyebrow">{branding?.eyebrow??'UNEENGINE WORKSPACE'}</div>
      <LoginRecovery onClose={closeRecovery}/></div></main>;
    return <main className={branding?'auth-screen auth-screen--standalone':'auth-screen'} style={loginStyle}>
      <form className="auth-card" onSubmit={(event) => void signIn(event)}
        onInvalid={(event) => {
          event.preventDefault();
          const input = event.target as HTMLInputElement;
          if (input.id === 'login-email') {
            setFieldErrors(current => ({...current, email: input.validity.typeMismatch ? 'Enter a valid email address.' : 'Email is required.'}));
          } else if (input.id === 'login-password') {
            setFieldErrors(current => ({...current, password: 'Password is required.'}));
          } else if (input.id === 'login-mfa') {
            setFieldErrors(current => ({...current, code: 'Enter your authenticator or backup code.'}));
          }
          setMessage('Correct the highlighted fields to continue.');
          if(document.activeElement!==input)input.focus();
        }}>
        {branding && <div className="auth-product-identity"><div className="auth-product-monogram" aria-hidden="true">{branding.label.slice(0,1)}</div><div><div className="eyebrow">{branding.eyebrow}</div><h1>{branding.label}</h1></div></div>}
        {!branding && <UneBrandLogo className="auth-brand-logo" src={logoUrl} />}
        {!branding && <div className="eyebrow">UNEENGINE WORKSPACE</div>}
        {branding ? <><h2 className="auth-product-heading">Welcome back</h2><p>{branding.signInDescription}</p></> : <><h1>Welcome back</h1><p>{mailAdminLogin?'Sign in to Mail Administration.':"Sign in to manage your organization’s metadata and workflows."}</p></>}
        {branding && <div className="auth-product-subline">{branding.tagline}</div>}
        {message && <div className="auth-error" role="alert">
          {message}{onRetry && <button type="button" className="text-action" onClick={onRetry}>Retry connection</button>}
        </div>}
        {challenge?<>
          <h2>{challenge.enrollment_required?'Set up your authenticator':'Verify your login'}</h2>
          {challenge.setup_secret&&<p>Add this key to your authenticator app: <code>{challenge.setup_secret}</code></p>}
          <label className="form-label" htmlFor="login-mfa">Authenticator or backup code</label>
          <input className="form-control" id="login-mfa" autoComplete="one-time-code" value={code} onChange={e=>{setCode(e.target.value);setFieldErrors(current=>({...current,code:undefined}));}} required maxLength={23}
            aria-invalid={Boolean(fieldErrors.code)} aria-describedby={fieldErrors.code?'login-mfa-error':undefined}/>
          {fieldErrors.code&&<small id="login-mfa-error" className="auth-field-error">{fieldErrors.code}</small>}
          {!challenge.enrollment_required&&<button type="button" className="btn" disabled={submitting} onClick={()=>void passkey()}>Use a passkey</button>}
          <button type="button" className="text-action" onClick={()=>{setChallenge(null);setCode('');setMessage('');}}>Start again</button>
        </>:<>
        <label className="form-label" htmlFor="login-email">Email</label>
        <input className="form-control" id="login-email" name="email" type="email" value={email} spellCheck={false} autoCapitalize="none" autoCorrect="off"
          onChange={(event) => {setEmail(event.target.value);setFieldErrors(current=>({...current,email:undefined}));}} autoComplete="username" required
          aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email?'login-email-error':undefined}/>
        {fieldErrors.email&&<small id="login-email-error" className="auth-field-error">{fieldErrors.email}</small>}
        <label className="form-label" htmlFor="login-password">Password</label>
        <div className="auth-password-control">
         <input className="form-control" id="login-password" name="password"
          type={passwordVisible ? 'text' : 'password'} value={password}
          onChange={(event) => {setPassword(event.target.value);setFieldErrors(current=>({...current,password:undefined}));}} autoComplete="current-password" required
          aria-invalid={Boolean(fieldErrors.password)} aria-describedby={fieldErrors.password?'login-password-error':undefined}/>
         <button className="text-action auth-password-toggle" type="button" aria-controls="login-password"
          aria-label={passwordVisible?'Hide password':'Show password'} aria-pressed={passwordVisible} onClick={()=>setPasswordVisible(value=>!value)}>{passwordVisible?<EyeOff size={18} aria-hidden="true"/>:<Eye size={18} aria-hidden="true"/>}</button>
        </div>
        {fieldErrors.password&&<small id="login-password-error" className="auth-field-error">{fieldErrors.password}</small>}
        <div className="auth-inline-actions auth-recovery-action">
          <button className="text-action" type="button" onClick={openRecovery}>Forgot password?</button>
        </div>
        {providers.map(provider=><button key={provider.id} type="button" className="btn" disabled={submitting} onClick={()=>{
          setSubmitting(true);void apiRequest<{url:string}>('/auth/federation/start',{method:'POST',body:JSON.stringify({providerId:provider.id})})
            .then(r=>{
              if(window.location.pathname==='/oauth/authorize')sessionStorage.setItem('md_oauth_return',JSON.stringify({query:window.location.search,expires:Date.now()+600000}));
              window.location.assign(r.url);
            }).catch(e=>{setMessage(e instanceof Error?e.message:String(e));setSubmitting(false);});
        }}>Continue with {provider.label}</button>)}
        </>}
        <button className="btn btn-brand auth-submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
        <nav className="auth-signin-footer" aria-label="Sign-in help and legal">
          <a href="mailto:support@unesolutions.co.uk">Contact support</a>
          <a href={import.meta.env.VITE_PRIVACY_POLICY_URL?.startsWith('https://')?import.meta.env.VITE_PRIVACY_POLICY_URL:`${import.meta.env.BASE_URL}privacy`} rel="noopener noreferrer">Privacy Policy</a>
          <a href={import.meta.env.VITE_TERMS_URL?.startsWith('https://')?import.meta.env.VITE_TERMS_URL:`${import.meta.env.BASE_URL}terms`} rel="noopener noreferrer">Terms</a>
          <small>Build {__METADRIVE_WEB_RELEASE__?.commit?.slice(0,7)??'development'}</small>
        </nav>
        {branding && <div className="auth-product-powered"><UneBrandLogo className="auth-product-powered-logo" src={logoUrl}/>Securely powered by MetaDrive</div>}
      </form>
    </main>;
  }

  return Login;
}
