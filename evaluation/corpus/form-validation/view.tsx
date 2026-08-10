import { form } from './state';
import { prepare } from './validation';

export function Form() {
  return <form><button onClick={() => prepare(form.email)}>{form.email.value}:{form.email.touched}</button><button onClick={() => prepare(form.name)}>{form.name.value}:{form.name.touched}</button></form>;
}
