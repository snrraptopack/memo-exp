import type { Todo } from './db';

export function TodoItem(props: {
  item: Todo;
  completedSet: Set<number>;
  categoryMap: Map<number, string>;
}) {
  const isDone = props.completedSet.has(props.item.id);
  const category = props.categoryMap.get(props.item.id) || 'General';

  return (
    <li class={isDone ? 'todo-item done' : 'todo-item'}>
      <div class="todo-content">
        <span
          class="todo-check"
          onClick={() => {
            if (props.completedSet.has(props.item.id)) {
              props.completedSet.delete(props.item.id);
            } else {
              props.completedSet.add(props.item.id);
            }
          }}
        >
          {isDone ? '☑' : '☐'}
        </span>
        <span class="todo-text">{props.item.text}</span>
        <span
          class="todo-badge"
          onClick={() => {
            const nextCat =
              category === 'Compiler'
                ? 'Network'
                : category === 'Network'
                ? 'Performance'
                : 'Compiler';
            props.categoryMap.set(props.item.id, nextCat);
          }}
        >
          🏷️ {category}
        </span>
      </div>
    </li>
  );
}
