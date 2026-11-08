/** Pure, pre-read limits for metadata-configured Flow Screen file uploads. */
export function validateFlowScreenUpload(selectedFiles, existingFiles, { maxFiles, maxFileSize, allowedTypes }) {
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1 || maxFiles > 10
    || !Number.isFinite(maxFileSize) || maxFileSize <= 0 || maxFileSize > 512 * 1024
    || !Array.isArray(allowedTypes) || allowedTypes.some(type => typeof type !== 'string')) {
    throw new Error('Flow screen file upload has invalid metadata limits.');
  }
  if ([...selectedFiles, ...existingFiles].some(file => !Number.isSafeInteger(file.size) || file.size < 0)) {
    throw new Error('Flow screen file metadata contains an invalid file size.');
  }
  if (selectedFiles.length + existingFiles.length > maxFiles) {
    throw new Error(`Choose no more than ${maxFiles} file${maxFiles === 1 ? '' : 's'}.`);
  }
  const bytes = [...existingFiles, ...selectedFiles].reduce((total, file) => total + Number(file.size ?? 0), 0);
  if (bytes > 512 * 1024) throw new Error('Selected files exceed the 512 KB total limit.');
  if (allowedTypes.length && [...existingFiles, ...selectedFiles].some(file => !allowedTypes.some(allowed => {
    const normalized = allowed.trim().toLowerCase();
    const mime = String(file.type || '').toLowerCase();
    return normalized === mime || (normalized.endsWith('/*') && mime.startsWith(normalized.slice(0, -1)))
      || (normalized.startsWith('.') && file.name.toLowerCase().endsWith(normalized));
  }))) throw new Error('A selected file type is not allowed for this Flow screen field.');
  if ([...existingFiles, ...selectedFiles].some(file => file.size > maxFileSize)) {
    throw new Error(`Each file must be no larger than ${Math.ceil(maxFileSize / 1024)} KB.`);
  }
}
