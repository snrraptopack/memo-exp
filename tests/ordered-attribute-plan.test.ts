import { expect, it } from 'vitest';
import { parseEstreeOrThrow, printEstree } from '../packages/compiler/src/ast';
import type * as t from '../packages/compiler/src/ast/compiler-types';
import { planOrderedAttributes } from '../packages/compiler/src/jsx/attributes';
import { emitOrderedAttributes } from '../packages/compiler/src/emission/ordered-attributes';

const fail = (message:string):never => {throw new Error(message);};
function attributes(source:string) {
  const program=parseEstreeOrThrow(`const node=(${source});`,{filename:'./attributes.tsx'}).program;
  return ((program.body[0] as unknown as t.VariableDeclaration).declarations[0]!.init as t.JSXElement).openingElement.attributes;
}

it('captures spread order, event overrides and non-identifier names without backend instrumentation',()=>{
  const source=attributes('<button onClick={first} {...left} disabled data-role="run" onClick={last} {...right} onInput={input} />');
  const before=JSON.stringify(source);
  const plan=planOrderedAttributes(source,{fail});
  expect(JSON.stringify(source)).toBe(before);
  expect(plan.entries.map(entry=>entry.type==='spread'?'spread':entry.name))
    .toEqual(['onClick','spread','disabled','data-role','onClick','spread','onInput']);
  expect(plan.safeEventKeys).toEqual(['onInput']);
  expect('expression' in plan).toBe(false);
  const planned=JSON.stringify(plan);
  const emitted=emitOrderedAttributes(plan);
  expect(JSON.stringify(plan)).toBe(planned);
  const value=new Function('first','left','last','right','input',`return (${printEstree(emitted).code});`);
  expect(value('first',{onClick:'left'},'last',{onClick:'right'},'input'))
    .toEqual({onClick:'right',disabled:true,'data-role':'run',onInput:'input'});
});

it('lets backend instrumentation change cloned values without altering the semantic plan or read sources',()=>{
  const plan=planOrderedAttributes(attributes('<Widget ref={target} onClick={callback} {...props}/>'),{fail});
  const before=JSON.stringify(plan), visits:string[]=[];
  const output=emitOrderedAttributes(plan,{
    attributeValue:(name,value)=>{visits.push(name);if(value.type==='Identifier')value.name='generated';return value;},
    eventValue:(name,value)=>{visits.push(`event:${name}`);return value;},
  });
  expect(visits).toEqual(['ref','onClick','event:onClick']);
  expect(JSON.stringify(plan)).toBe(before);
  expect(printEstree(output).code).toContain('generated');
  expect(plan.entries.map(entry=>printEstree(entry.value).code)).toEqual(['target','callback','props']);
});

it('omits only list keys and retains namespaced attributes',()=>{
  const plan=planOrderedAttributes(attributes('<svg key={id} xlink:href={url}/>'),{skipKey:true,fail});
  expect(plan.entries.map(entry=>entry.type==='attribute'&&entry.name)).toEqual(['xlink:href']);
});
