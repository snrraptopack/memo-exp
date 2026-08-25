import * as _MD from "@memoized-dom/runtime";
import * as _MDD from "@memoized-dom/data/internal";
_MD.installAccessTable({
  readers: {
    "./session.ts#currentUser": ["WorkspaceApp/UserBadge", "WorkspaceApp/UserBadge/*"],
    "./session.ts#notifications": ["WorkspaceApp/NotificationsPanel", "WorkspaceApp/NotificationsPanel/*", "WorkspaceApp/NotificationsPanel/when0", "WorkspaceApp/NotificationsPanel/when0/*", "WorkspaceApp/NotificationsPanel/when0/notifications/Row[*]", "WorkspaceApp/NotificationsPanel/when0/notifications/Row[*]/*"]
  }
}, "WorkspaceApp", "./WorkspaceApp.tsx");
import { $ops, $track, Group, Pending, Error as ErrorArm } from '@memoized-dom/data';
import { currentUser, notifications } from './session';
function UserBadge(_id, _parent) {
  let _slot, _slot2, _slot3, _value;
  const _update = () => {
    if (_slot !== (_value = _MDD.readResolvedValuesForRender([_MDD.sourceRef("./session.ts#currentUser")], _currentUserValue => _currentUserValue.name.charAt(0)))) {
      _slot = _value;
      _text.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
    }
    if (_slot2 !== (_value = _MDD.readResolvedValuesForRender([_MDD.sourceRef("./session.ts#currentUser")], _currentUserValue2 => _currentUserValue2.name))) {
      _slot2 = _value;
      _text2.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
    }
    if (_slot3 !== (_value = _MDD.readResolvedValuesForRender([_MDD.sourceRef("./session.ts#currentUser")], _currentUserValue3 => _currentUserValue3.email))) {
      _slot3 = _value;
      _text3.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
    }
  };
  _MD.register({
    id: _id,
    parent: _parent,
    render: _update
  });
  const _text = document.createTextNode("");
  if (_slot !== (_value = _MDD.readResolvedValuesForRender([_MDD.sourceRef("./session.ts#currentUser")], _currentUserValue => _currentUserValue.name.charAt(0)))) {
    _slot = _value;
    _text.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
  }
  const _span = document.createElement("span");
  _MD.setClassValue(_span, "avatar");
  _span.appendChild(_text);
  const _text2 = document.createTextNode("");
  if (_slot2 !== (_value = _MDD.readResolvedValuesForRender([_MDD.sourceRef("./session.ts#currentUser")], _currentUserValue2 => _currentUserValue2.name))) {
    _slot2 = _value;
    _text2.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
  }
  const _strong = document.createElement("strong");
  _strong.appendChild(_text2);
  const _text3 = document.createTextNode("");
  if (_slot3 !== (_value = _MDD.readResolvedValuesForRender([_MDD.sourceRef("./session.ts#currentUser")], _currentUserValue3 => _currentUserValue3.email))) {
    _slot3 = _value;
    _text3.data = _value == null || typeof _value === "boolean" ? "" : String(_value);
  }
  const _small = document.createElement("small");
  _small.appendChild(_text3);
  const _span2 = document.createElement("span");
  _MD.setClassValue(_span2, "who");
  _span2.appendChild(_strong);
  _span2.appendChild(_small);
  const _span3 = document.createElement("span");
  _MD.setClassValue(_span3, "badge");
  _span3.appendChild(_span);
  _span3.appendChild(_span2);
  return _span3;
}
function NotificationsPanel(_id2, _parent2) {
  let _slot4, _slot5, _slot6, _value2;
  let state = _MDD.deriveResolvedValues([notifications], _notificationsValue => $track(notifications));
  let unread = _MDD.deriveResolvedValues([notifications], _notificationsValue2 => _notificationsValue2.filter(n => !n.read).length);
  const _update2 = () => {
    {
      {
        state = _MDD.deriveResolvedValues([notifications], _notificationsValue => $track(notifications));
        unread = _MDD.deriveResolvedValues([notifications], _notificationsValue2 => _notificationsValue2.filter(n => !n.read).length);
      }
    }
    if (_slot4 !== (_value2 = _MDD.readResolvedValuesForRender([notifications], _notificationsValue3 => _notificationsValue3.filter(n => !n.read).length))) {
      _slot4 = _value2;
      _text5.data = _value2 == null || typeof _value2 === "boolean" ? "" : String(_value2);
    }
    if (_slot5 !== (_value2 = _MDD.readResolvedValuesForRender([notifications], _notificationsValue5 => $track(notifications).refreshing ? 'Syncing…' : 'Refresh'))) {
      _slot5 = _value2;
      _text7.data = _value2 == null || typeof _value2 === "boolean" ? "" : String(_value2);
    }
    if (_slot6 !== (_value2 = _MD.classValue(_MDD.readResolvedValuesForRender([notifications], _notificationsValue4 => $track(notifications).refreshing ? 'ghost spinning' : 'ghost')))) {
      _slot6 = _value2;
      _MD.setClassValue(_button, _value2);
    }
    _when.update();
  };
  _MD.register({
    id: _id2,
    parent: _parent2,
    render: _update2,
    volatile: true
  });
  const _text4 = document.createTextNode("Notifications");
  const _h = document.createElement("h2");
  _h.appendChild(_text4);
  const _text5 = document.createTextNode("");
  if (_slot4 !== (_value2 = _MDD.readResolvedValuesForRender([notifications], _notificationsValue3 => _notificationsValue3.filter(n => !n.read).length))) {
    _slot4 = _value2;
    _text5.data = _value2 == null || typeof _value2 === "boolean" ? "" : String(_value2);
  }
  _MD.register({
    id: _id2 + "/$data/0",
    parent: _id2,
    render: () => {
      if (_slot4 !== (_value2 = _MDD.readResolvedValuesForRender([notifications], _notificationsValue3 => _notificationsValue3.filter(n => !n.read).length))) {
        _slot4 = _value2;
        _text5.data = _value2 == null || typeof _value2 === "boolean" ? "" : String(_value2);
      }
    }
  });
  const _text6 = document.createTextNode(" unread");
  const _span4 = document.createElement("span");
  _MD.setClassValue(_span4, "pill");
  _span4.appendChild(_text5);
  _span4.appendChild(_text6);
  const _text7 = document.createTextNode("");
  if (_slot5 !== (_value2 = _MDD.readResolvedValuesForRender([notifications], _notificationsValue5 => $track(notifications).refreshing ? 'Syncing…' : 'Refresh'))) {
    _slot5 = _value2;
    _text7.data = _value2 == null || typeof _value2 === "boolean" ? "" : String(_value2);
  }
  _MD.register({
    id: _id2 + "/$data/1",
    parent: _id2,
    render: () => {
      if (_slot5 !== (_value2 = _MDD.readResolvedValuesForRender([notifications], _notificationsValue5 => $track(notifications).refreshing ? 'Syncing…' : 'Refresh'))) {
        _slot5 = _value2;
        _text7.data = _value2 == null || typeof _value2 === "boolean" ? "" : String(_value2);
      }
    }
  });
  const _button = document.createElement("button");
  if (_slot6 !== (_value2 = _MD.classValue(_MDD.readResolvedValuesForRender([notifications], _notificationsValue4 => $track(notifications).refreshing ? 'ghost spinning' : 'ghost')))) {
    _slot6 = _value2;
    _MD.setClassValue(_button, _value2);
  }
  _MD.register({
    id: _id2 + "/$data/2",
    parent: _id2,
    render: () => {
      if (_slot6 !== (_value2 = _MD.classValue(_MDD.readResolvedValuesForRender([notifications], _notificationsValue4 => $track(notifications).refreshing ? 'ghost spinning' : 'ghost')))) {
        _slot6 = _value2;
        _MD.setClassValue(_button, _value2);
      }
    }
  });
  _button.onclick = () => {
    void $ops(notifications).refresh();
  };
  _button.appendChild(_text7);
  const _div = document.createElement("div");
  _MD.setClassValue(_div, "panel-head");
  _div.appendChild(_h);
  _div.appendChild(_span4);
  _div.appendChild(_button);
  const _ul = document.createElement("ul");
  _MD.setClassValue(_ul, "list");
  _MD.register({
    id: _id2 + "/when0",
    parent: _id2,
    render: () => _when.update()
  });
  const _when = _MD.createCondRegion(_ul, _id2 + "/when0", () => _MDD.resolvedValuesError([notifications]) ? 0 : _MDD.resolvedValuesPending([notifications]) ? 1 : 2, [() => {
    let _value3;
    const _update3 = () => {
      _MD.setProps(_id2 + "/when0" + "/ErrorRow", [{
        error: _MDD.resolvedValuesError([notifications]),
        retry: _retryCallback
      }]);
    };
    const _retryCallback = () => _MDD.retryResolvedValues([notifications]);
    const _errorRow = ErrorRow(_id2 + "/when0" + "/ErrorRow", _id2 + "/when0", [{
      error: _MDD.resolvedValuesError([notifications]),
      retry: _retryCallback
    }]);
    return {
      nodes: _MD.rootNodes(_errorRow),
      update: _update3,
      dispose: () => {
        _MD.unregisterSubtree(_id2 + "/when0" + "/ErrorRow");
      }
    };
  }, () => {
    let _value4;
    const _update4 = () => {};
    const _skeleton = Skeleton(_id2 + "/when0" + "/Skeleton", _id2 + "/when0");
    return {
      nodes: _MD.rootNodes(_skeleton),
      update: _update4,
      dispose: () => {
        _MD.unregisterSubtree(_id2 + "/when0" + "/Skeleton");
      }
    };
  }, () => {
    let _value5;
    const _update5 = () => {
      _region.reconcile(_MDD.readModuleSourceList(_MDD.sourceRef("./session.ts#notifications")));
    };
    const _fragment = document.createDocumentFragment();
    const _onClickBinding = _MD.createDelegatedEventBinding(_fragment, "onClick");
    const _region = _MD.createListRegion(_fragment, _id2 + "/when0" + "/./session.ts#notifications", (n, _rowId) => {
      let _slot7, _slot8, _value6;
      const _update6 = () => {
        if (_slot7 !== (_value6 = n.text)) {
          _slot7 = _value6;
          _text8.data = _value6 == null || typeof _value6 === "boolean" ? "" : String(_value6);
        }
        if (_slot8 !== (_value6 = _MD.classValue(n.read ? 'row read' : 'row unread'))) {
          _slot8 = _value6;
          _MD.setClassValue(_li, _value6);
        }
        _when2.update();
      };
      _MD.register({
        id: _rowId,
        parent: _id2 + "/when0",
        render: _update6
      });
      const _text8 = document.createTextNode("");
      if (_slot7 !== (_value6 = n.text)) {
        _slot7 = _value6;
        _text8.data = _value6 == null || typeof _value6 === "boolean" ? "" : String(_value6);
      }
      const _span5 = document.createElement("span");
      _span5.appendChild(_text8);
      const _li = document.createElement("li");
      if (_slot8 !== (_value6 = _MD.classValue(n.read ? 'row read' : 'row unread'))) {
        _slot8 = _value6;
        _MD.setClassValue(_li, _value6);
      }
      _li.appendChild(_span5);
      _MD.register({
        id: _rowId + "/when0",
        parent: _rowId,
        render: () => _when2.update()
      });
      const _when2 = _MD.createCondRegion(_li, _rowId + "/when0", () => !n.read ? 0 : 1, [() => {
        let _value7;
        const _update7 = () => {};
        const _text9 = document.createTextNode("Mark read");
        const _button2 = document.createElement("button");
        _MD.setClassValue(_button2, "tiny");
        _button2.onclick = () => {
          $ops(notifications).mutate(items => {
            for (const item of items ?? []) {
              if (item.id === n.id) item.read = true;
            }
          });
        };
        _button2.appendChild(_text9);
        return {
          nodes: _MD.rootNodes(_button2),
          update: _update7
        };
      }, null]);
      return {
        nodes: [_li],
        entities: [_rowId],
        updateProps: _nextItem => {
          n = _nextItem;
        },
        update: _update6
      };
    }, n => n.id);
    _region.reconcile(_MDD.readModuleSourceList(_MDD.sourceRef("./session.ts#notifications")));
    return {
      nodes: _MD.rootNodes(_fragment),
      update: _update5,
      dispose: () => {
        _region.dispose();
      }
    };
  }]);
  const _section = document.createElement("section");
  _MD.setClassValue(_section, "panel");
  _section.appendChild(_div);
  _section.appendChild(_ul);
  _MD.cleanup(_id2 + "/$data/0", _MDD.connectResolvedValues([notifications], () => _MD.markDirty(_id2 + "/$data/0")));
  _MD.cleanup(_id2 + "/$data/1", _MDD.connectResolvedValues([notifications], () => _MD.markDirty(_id2 + "/$data/1")));
  _MD.cleanup(_id2 + "/$data/2", _MDD.connectResolvedValues([notifications], () => _MD.markDirty(_id2 + "/$data/2")));
  _MD.cleanup(_id2 + "/when0", _MDD.connectResolvedValues([notifications, notifications], () => _MD.markDirty(_id2 + "/when0")));
  return _section;
}
function Skeleton(_id3, _parent3) {
  let _value8;
  const _update8 = () => {};
  _MD.register({
    id: _id3,
    parent: _parent3,
    render: _update8
  });
  const _text0 = document.createTextNode("▒▒▒▒▒▒▒▒");
  const _li2 = document.createElement("li");
  _MD.setClassValue(_li2, "row skeleton");
  _li2.appendChild(_text0);
  const _text1 = document.createTextNode("▒▒▒▒▒▒");
  const _li3 = document.createElement("li");
  _MD.setClassValue(_li3, "row skeleton");
  _li3.appendChild(_text1);
  const _ul2 = document.createElement("ul");
  _MD.setClassValue(_ul2, "list");
  _ul2.appendChild(_li2);
  _ul2.appendChild(_li3);
  return _ul2;
}
function ErrorRow(_id4, _parent4, _props) {
  let _slot9, _value9;
  let {
    error,
    retry
  } = _props[0];
  const _update9 = () => {
    {
      ({
        error,
        retry
      } = _props[0]);
    }
    if (_slot9 !== (_value9 = error.message)) {
      _slot9 = _value9;
      _text10.data = _value9 == null || typeof _value9 === "boolean" ? "" : String(_value9);
    }
  };
  _MD.register({
    id: _id4,
    parent: _parent4,
    render: _update9
  });
  _MD.registerProps(_id4, _props);
  const _text10 = document.createTextNode("");
  if (_slot9 !== (_value9 = error.message)) {
    _slot9 = _value9;
    _text10.data = _value9 == null || typeof _value9 === "boolean" ? "" : String(_value9);
  }
  const _text11 = document.createTextNode("Retry");
  const _button3 = document.createElement("button");
  _MD.setClassValue(_button3, "tiny");
  _button3.onclick = _event => {
    const _returnValue = retry(_event);
    _MD.markDirty(_id4);
    return _returnValue;
  };
  _button3.appendChild(_text11);
  const _li4 = document.createElement("li");
  _MD.setClassValue(_li4, "row error");
  _li4.appendChild(_text10);
  _li4.appendChild(_button3);
  const _ul3 = document.createElement("ul");
  _MD.setClassValue(_ul3, "list");
  _ul3.appendChild(_li4);
  return _ul3;
}
export function WorkspaceApp(_id5, _parent5) {
  let _value0;
  const _update0 = () => {};
  _MD.register({
    id: _id5,
    parent: _parent5,
    render: _update0
  });
  const _text12 = document.createTextNode("Workspace");
  const _h2 = document.createElement("h1");
  _h2.appendChild(_text12);
  const _userBadge = UserBadge(_id5 + "/UserBadge", _id5);
  const _header = document.createElement("header");
  _MD.setClassValue(_header, "top");
  _header.appendChild(_h2);
  _header.appendChild(_userBadge);
  const _notificationsPanel = NotificationsPanel(_id5 + "/NotificationsPanel", _id5);
  const _text13 = document.createTextNode("Module-scope sources + colorless reads. Refresh keeps committed rows visible while syncing.");
  const _p = document.createElement("p");
  _MD.setClassValue(_p, "hint");
  _p.appendChild(_text13);
  const _main = document.createElement("main");
  _MD.setClassValue(_main, "workspace");
  _main.appendChild(_header);
  _main.appendChild(_notificationsPanel);
  _main.appendChild(_p);
  return _main;
}
_MD.registerRootFactory(WorkspaceApp, {
  id: "WorkspaceApp",
  create: () => WorkspaceApp("WorkspaceApp", null, [])
});