// @ts-nocheck
/**
 * Generated from examples/TodoItem.tsx; rebuild with bun run examples/build-todo.ts.
 */
import * as _MD from "../../src/runtime";
export function TodoItem(props, _id) {
  let _slot, _slot2, _slot3, _slot4, _value;
  let isDone = props.completedSet.has(props.item.id);
  let category = props.categoryMap.get(props.item.id) || 'General';
  const _update = () => {
    {
      isDone = props.completedSet.has(props.item.id);
      category = props.categoryMap.get(props.item.id) || 'General';
    }
    if (_slot !== (_value = isDone ? '☑' : '☐')) {
      _slot = _value;
      _text.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
    }
    if (_slot2 !== (_value = props.item.text)) {
      _slot2 = _value;
      _text2.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
    }
    if (_slot3 !== (_value = category)) {
      _slot3 = _value;
      _text4.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
    }
    if (_slot4 !== (_value = _MD.classValue(isDone ? 'todo-item done' : 'todo-item'))) {
      _slot4 = _value;
      _MD.setClassValue(_li, _value);
    }
  };
  const _text = document.createTextNode("");
  if (_slot !== (_value = isDone ? '☑' : '☐')) {
    _slot = _value;
    _text.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
  }
  const _span = document.createElement("span");
  _MD.setClassValue(_span, "todo-check");
  _span.onclick = () => {
    if (props.completedSet.has(props.item.id)) {
      props.completedSet.delete(props.item.id);
    } else {
      props.completedSet.add(props.item.id);
    }
    _update();
  };
  _span.appendChild(_text);
  const _text2 = document.createTextNode("");
  if (_slot2 !== (_value = props.item.text)) {
    _slot2 = _value;
    _text2.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
  }
  const _span2 = document.createElement("span");
  _MD.setClassValue(_span2, "todo-text");
  _span2.appendChild(_text2);
  const _text3 = document.createTextNode("🏷️ ");
  const _text4 = document.createTextNode("");
  if (_slot3 !== (_value = category)) {
    _slot3 = _value;
    _text4.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
  }
  const _span3 = document.createElement("span");
  _MD.setClassValue(_span3, "todo-badge");
  _span3.onclick = () => {
    const nextCat = category === 'Compiler' ? 'Network' : category === 'Network' ? 'Performance' : 'Compiler';
    props.categoryMap.set(props.item.id, nextCat);
    _update();
  };
  _span3.appendChild(_text3);
  _span3.appendChild(_text4);
  const _div = document.createElement("div");
  _MD.setClassValue(_div, "todo-content");
  _div.appendChild(_span);
  _div.appendChild(_span2);
  _div.appendChild(_span3);
  const _li = document.createElement("li");
  if (_slot4 !== (_value = _MD.classValue(isDone ? 'todo-item done' : 'todo-item'))) {
    _slot4 = _value;
    _MD.setClassValue(_li, _value);
  }
  _li.appendChild(_div);
  return {
    nodes: _MD.rootNodes(_li),
    entities: [],
    update: _update,
    updateProps: _nextProp => {
      props = _nextProp;
    }
  };
}
