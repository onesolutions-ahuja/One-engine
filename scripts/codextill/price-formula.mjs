// Renderer-compatible GBP price text, padded to exactly two decimals for
// non-negative POS prices. Uses only the existing bounded formula functions.
export const PRICE_FORMULA='"£" & TEXT(FLOOR(ROUND(@Price * 100, 0) / 100)) & "." & RIGHT("0" & TEXT(MOD(ROUND(@Price * 100, 0), 100)), 2)';
