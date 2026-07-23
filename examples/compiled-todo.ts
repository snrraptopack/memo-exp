/**
 * Generated Compiled Output for examples/todo.tsx
 */
import * as MD from "../src/runtime";
const WRITES_0 = ["todos"];
const WRITES_1 = ["todos"];
const WRITES_2 = ["count"];
MD.installAccessTable({
  readers: {
    "count": ["TodoApp", "TodoApp/*"],
    "todos": ["TodoApp", "TodoApp/$computed/count", "TodoApp/*"]
  }
}, "TodoApp");
let todos = [{
  id: 1,
  text: 'Learn Memoized DOM Compiler',
  done: true
}, {
  id: 2,
  text: 'Build a Live Todo App',
  done: false
}, {
  id: 3,
  text: 'Benchmark Performance',
  done: false
}];
let count = todos.filter(it => it.done).length;
MD.register({
  id: "TodoApp/$computed/count",
  parent: null,
  depth: -1,
  render: () => {
    const next = todos.filter(it => it.done).length;
    if (MD.computedChanged(count, next)) {
      count = next;
      MD.commitWrites(WRITES_2);
    }
  }
});
function TodoItem(props, __memoRowId) {
  let $s0, $s1, $s2, $t;
  const update = () => {
    if ($s0 !== ($t = props.item.done ? '☑ ' : '☐ ')) {
      $s0 = $t;
      text0.data = $t == null || typeof $t === "boolean" ? "" : String($t);
    }
    if ($s1 !== ($t = props.item.text)) {
      $s1 = $t;
      text1.data = $t == null || typeof $t === "boolean" ? "" : String($t);
    }
    if ($s2 !== ($t = props.item.done ? 'todo-item done' : 'todo-item')) {
      $s2 = $t;
      li0.className = $t;
    }
  };
  const text0 = document.createTextNode("");
  if ($s0 !== ($t = props.item.done ? '☑ ' : '☐ ')) {
    $s0 = $t;
    text0.data = $t == null || typeof $t === "boolean" ? "" : String($t);
  }
  const text1 = document.createTextNode("");
  if ($s1 !== ($t = props.item.text)) {
    $s1 = $t;
    text1.data = $t == null || typeof $t === "boolean" ? "" : String($t);
  }
  const span0 = document.createElement("span");
  span0.onclick = () => {
    props.item.done = !props.item.done;
    update();
  };
  span0.appendChild(text0);
  span0.appendChild(text1);
  const li0 = document.createElement("li");
  if ($s2 !== ($t = props.item.done ? 'todo-item done' : 'todo-item')) {
    $s2 = $t;
    li0.className = $t;
  }
  li0.appendChild(span0);
  return {
    nodes: [li0],
    entities: [],
    update: update,
    updateProps: __memoNext0 => {
      props = __memoNext0;
    }
  };
}
export function TodoApp(id, parent) {
  let $s0, $s1, $t;
  let timer = 0;
  const startTimer = () => setInterval(() => timer++, 1000);
  const update = () => {
    if ($s0 !== ($t = timer)) {
      $s0 = $t;
      text1.data = $t == null || typeof $t === "boolean" ? "" : String($t);
    }
    if ($s1 !== ($t = count)) {
      $s1 = $t;
      text3.data = $t == null || typeof $t === "boolean" ? "" : String($t);
    }
    region0.reconcile(todos);
  };
  MD.register({
    id: id,
    parent: parent,
    render: update
  });
  const text0 = document.createTextNode("⚡ Memoized DOM Todo App ");
  const text1 = document.createTextNode("");
  if ($s0 !== ($t = timer)) {
    $s0 = $t;
    text1.data = $t == null || typeof $t === "boolean" ? "" : String($t);
  }
  const h10 = document.createElement("h1");
  h10.appendChild(text0);
  h10.appendChild(text1);
  const text2 = document.createTextNode("Built with Reactive Memoized DOM ");
  const text3 = document.createTextNode("");
  if ($s1 !== ($t = count)) {
    $s1 = $t;
    text3.data = $t == null || typeof $t === "boolean" ? "" : String($t);
  }
  const p0 = document.createElement("p");
  p0.className = "subtitle";
  p0.appendChild(text2);
  p0.appendChild(text3);
  const text4 = document.createTextNode("➕ Add Task");
  const button0 = document.createElement("button");
  button0.onclick = () => {
    todos.push({
      id: Date.now(),
      text: `New Task #${todos.length + 1}`,
      done: false
    });
    MD.commitWrites(WRITES_0);
  };
  button0.appendChild(text4);
  const text5 = document.createTextNode("🧹 Clear Completed");
  const button1 = document.createElement("button");
  button1.onclick = () => {
    todos = todos.filter(t => !t.done);
    startTimer();
    MD.commitWrites(WRITES_1);
  };
  button1.appendChild(text5);
  const div0 = document.createElement("div");
  div0.className = "actions";
  div0.appendChild(button0);
  div0.appendChild(button1);
  const ul0 = document.createElement("ul");
  const region0 = MD.createListRegion(ul0, id + "/todos", (item, rowId) => {
    const entry = TodoItem({
      item
    }, rowId);
    return {
      nodes: entry.nodes,
      entities: [],
      update: entry.update,
      updateProps: item => {
        entry.updateProps({
          item
        });
      }
    };
  }, item => item.id);
  region0.reconcile(todos);
  const div1 = document.createElement("div");
  div1.className = "todo-card";
  div1.appendChild(h10);
  div1.appendChild(p0);
  div1.appendChild(div0);
  div1.appendChild(ul0);
  return div1;
}
