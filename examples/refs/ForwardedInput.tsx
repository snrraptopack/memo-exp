export interface ForwardedInputProps {
  label: string;
  ref?: unknown;
  inputRef?: unknown;
  id?: string;
  placeholder?: string;
}

/** R44: components choose which host receives a forwarded ref adapter. */
export function ForwardedInput({
  label,
  ref: forwardedRef,
  inputRef,
  ...rest
}: ForwardedInputProps) {
  return (
    <label class="ref-field">
      <span>{label}</span>
      <input ref={[forwardedRef, inputRef]} {...rest} />
    </label>
  );
}
