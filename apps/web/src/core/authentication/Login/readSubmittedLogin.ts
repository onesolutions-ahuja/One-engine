/** Read actual submitted fields, including browser autofill that did not fire React events. */
export function readSubmittedLogin(values: FormData) {
  return {
    email: String(values.get('email') ?? '').trim(),
    password: String(values.get('password') ?? '')
  };
}
