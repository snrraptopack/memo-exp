/* oxlint-disable no-unused-expressions -- compiler-generated mutation sequences */
import * as _MD from "@memoized-dom/runtime";

const _REASONS_ = [1, 2, 3];
const _WRITES_ = ["./bench/dom/data.ts#nextId"];
const _REASONS_2 = [1, 2];

const _WRITES_2 = [
	"./bench/dom/data.ts#adjectives",
	"./bench/dom/data.ts#colours",
	"./bench/dom/data.ts#nextId",
	"./bench/dom/data.ts#nouns"
];

let _liTemplate, _liTemplateDocument;

function _liCreateTemplate(_document2) {
	const _text10 = _document2.createTextNode("");
	const _li = _document2.createElement("li");

	_li.appendChild(_text10);

	return _li;
}

const _HTML_ = "<div><div class=\"toolbar\"><button>create1k</button><button>create10k</button><button>append1k</button><button>prepend1k</button><button>pop1k</button><button>update</button><button>swap</button><button>reverse</button><button>remove</button><button>remove100</button><button>clear</button></div><ul></ul></div>";

import { buildData } from './data';

export function BenchAppInlineOwned(_id, _parent, _dataPolicies) {
	let _value;
	let data = [];
	let selected = null;

	const _update = (_reasons = null) => {
		if (!_MD.reasonsOnly(_reasons, [0, 2, 3]) || (_reasons === 1 || _reasons !== null && (typeof _reasons === "object" && _reasons.has(1))) || (_reasons === 2 || _reasons !== null && (typeof _reasons === "object" && _reasons.has(2))) && !(_reasons === 0 || _reasons !== null && (typeof _reasons === "object" && _reasons.has(0)))) {
			_region.reconcile(data, _MD.isStructuralListUpdate(_reasons, ""));
			_selectedListKey = selected;
			_dataChangedKeys.clear();
		} else {
			if (_reasons === 0 || _reasons !== null && (typeof _reasons === "object" && _reasons.has(0))) {
				for (const _changedListKey of _dataChangedKeys) {
					_region.refreshKey(_changedListKey);
				}

				_dataChangedKeys.clear();
			}

			if (_reasons === 3 || _reasons !== null && (typeof _reasons === "object" && _reasons.has(3))) {
				const _previousListKey = _selectedListKey;

				_selectedListKey = selected;
				_region.refreshKey(_previousListKey);

				if (!Object.is(_previousListKey, _selectedListKey)) _region.refreshKey(_selectedListKey);
			}
		}
	};

	_MD.register({ id: _id, parent: _parent, render: _update });

	const _markup = _MD.materializeMarkup(_HTML_);
	const _button = _markup[1];
	const _button2 = _markup[3];
	const _button3 = _markup[5];
	const _button4 = _markup[7];
	const _button5 = _markup[9];
	const _button6 = _markup[11];
	const _button7 = _markup[13];
	const _button8 = _markup[15];
	const _button9 = _markup[17];
	const _button0 = _markup[19];
	const _button1 = _markup[21];
	const _ul = _markup[23];
	const _div2 = _markup[24];

	_button.onclick = () => {
		data = buildData(1000);
		selected = null;

		{
			_MD.markDirty(_id, _REASONS_);
			_MD.commitWrites(_WRITES_);
		}
	};

	_button2.onclick = () => {
		data = buildData(10000);
		selected = null;

		{
			_MD.markDirty(_id, _REASONS_);
			_MD.commitWrites(_WRITES_);
		}
	};

	_button3.onclick = () => {
		data = data.concat(buildData(1000));

		{
			_MD.markDirty(_id, _REASONS_2);
			_MD.commitWrites(_WRITES_);
		}
	};

	_button4.onclick = () => {
		data = buildData(1000).concat(data);

		{
			_MD.markDirty(_id, _REASONS_2);
			_MD.commitWrites(_WRITES_2);
		}
	};

	_button5.onclick = () => {
		data = data.slice(0, -1000);
		_MD.markDirty(_id, _REASONS_2);
	};

	_button6.onclick = () => {
		let _didWrite = false;

		for (let i = 0; i < data.length; i += 10) (_didWrite = true, data[i].label += ' !!!');

		{
			if (_didWrite) _MD.markDirtySubtree("BenchAppInlineOwned", _id, _REASONS_2);
		}
	};

	_button7.onclick = () => {
		let _didWrite2 = false, _didWrite3 = false;

		if (data.length > 998) {
			const t = data[1];

			(_didWrite2 = true, data[1] = data[998]);
			(_didWrite3 = true, data[998] = t);
		}

		{
			if (_didWrite2 || _didWrite3) _MD.markDirtySubtree("BenchAppInlineOwned", _id, _REASONS_2);
		}
	};

	_button8.onclick = () => {
		data.reverse();
		_MD.markDirty(_id, _REASONS_2);
	};

	_button9.onclick = () => {
		data.splice(500, 1);
		_MD.markDirty(_id, _REASONS_2);
	};

	_button0.onclick = () => {
		data = data.filter((_item, index) => index % 100 !== 0);
		_MD.markDirty(_id, _REASONS_2);
	};

	_button1.onclick = () => {
		data = [];
		selected = null;
		_MD.markDirty(_id, _REASONS_);
	};

	const _onClickBinding = _MD.createDelegatedEventBinding(_ul, "onClick");

	const _region = _MD.createListRegion(
		_ul,
		_id + "/data",
		(item, _rowId) => {
			let _slot, _slot2, _slot3, _slot4, _slot5, _value2;

			const _update2 = () => {
				{
					const _textLeft = item.id;

					if (typeof _textLeft === "number" || typeof _textLeft === "string") {
						const _textRight = item.label;

						if (typeof _textRight === "number" || typeof _textRight === "string") {
							if (!_slot4 || (_slot2 !== _textLeft || _slot3 !== _textRight)) {
								_slot2 = _textLeft;
								_slot3 = _textRight;
								_slot4 = true;

								if (_slot !== (_value2 = _MD.textValue(_textLeft + ": " + _textRight))) {
									_slot = _value2;
									_text10.data = _value2;
								}
							}
						} else try {
							if (_slot !== (_value2 = _MD.textValue(_textLeft + ": " + _textRight))) {
								_slot = _value2;
								_text10.data = _value2;
							}
						} finally {
							_slot4 = false;
						}
					} else try {
						if (_slot !== (_value2 = _MD.textValue(_textLeft + ": " + item.label))) {
							_slot = _value2;
							_text10.data = _value2;
						}
					} finally {
						_slot4 = false;
					}
				}

				if (_slot5 !== (_value2 = selected === item.id ? "danger" : "")) {
					_slot5 = _value2;
					_MD.setClassValue(_li, _value2);
				}
			};

			const _document2 = _MD.getActiveEnvironment().document;
			const _canReuseTemplate = _MD.canReuseTemplate();
			let _li;

			if (_canReuseTemplate) {
				if (_liTemplate === void 0 || _liTemplateDocument !== _document2) {
					_liTemplateDocument = _document2;
					_liTemplate = _liCreateTemplate(_document2);
				}

				_li = _liTemplate.cloneNode(true);
			} else {
				_li = _liCreateTemplate(_document2);
			}

			const _text10 = _li.firstChild;

			{
				const _textLeft = item.id;

				if (typeof _textLeft === "number" || typeof _textLeft === "string") {
					const _textRight = item.label;

					if (typeof _textRight === "number" || typeof _textRight === "string") {
						{
							_slot2 = _textLeft;
							_slot3 = _textRight;
							_slot4 = true;
							_slot = _MD.textValue(_textLeft + ": " + _textRight);
						}
					} else try {
						_slot = _MD.textValue(_textLeft + ": " + _textRight);
					} finally {
						_slot4 = false;
					}
				} else try {
					_slot = _MD.textValue(_textLeft + ": " + item.label);
				} finally {
					_slot4 = false;
				}
			}

			_MD.setTextData(_text10, _slot);

			if (_slot5 !== (_value2 = selected === item.id ? "danger" : "")) {
				_slot5 = _value2;
				_MD.setClassValue(_li, _value2);
			}

			_MD.setDelegatedEvent(_onClickBinding, _li, () => {
				selected = item.id;
				_MD.markDirty(_id, 3);
			});

			return {
				nodes: _li,
				entities: [],
				updateProps: (_nextItem) => {
					item = _nextItem;
				},
				update: _update2
			};
		},
		(item) => item.id,
		false,
		false,
		true
	);

	const _dataChangedKeys = new Set();
	let _selectedListKey = selected;

	_region.reconcile(data);
	_MD.cleanup(_id, () => _region.dispose());

	return _div2;
}

_MD.registerRootFactory(BenchAppInlineOwned, {
	id: "BenchAppInlineOwned",
	create: () => BenchAppInlineOwned("BenchAppInlineOwned", null, [])
});

export function createCompiledInlineOwnedApp() {
  const root = BenchAppInlineOwned('BenchAppInlineOwned', null) as HTMLElement;
  const toolbar = root.querySelector('.toolbar') as HTMLElement;
  const ul = root.querySelector('ul') as HTMLElement;
  return {
    root,
    click(name: string) {
      const button = [...toolbar.children].find(child => child.textContent === name) as HTMLButtonElement;
      if (!button) throw new Error(`Button '${name}' not found in AppInlineOwned`);
      button.click();
    },
    selectRow(index: number) { (ul.children[index] as HTMLElement).click(); },
    rowCount() { return ul.children.length; },
  };
}
