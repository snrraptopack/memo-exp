// Fixture: R8 conditional region — a login toggle written as plain TSX.
// 'loggedIn' is read ONLY by the region (condition), 'count' only by the
// then-branch — both must route to 'App/when0', never to the owner. Branch
// swaps destroy DOM but module state survives, so 'count' persists.
let loggedIn = false;
let count = 0;

export function CondApp() {
  const toggle = () => {
    loggedIn = !loggedIn;
  };
  const inc = () => {
    count++;
  };
  return (
    <div>
      <button onClick={toggle}>toggle</button>
      {loggedIn ? (
        <span class="in">
          in {count} <button onClick={inc}>+</button>
        </span>
      ) : (
        <span class="out">out</span>
      )}
    </div>
  );
}
