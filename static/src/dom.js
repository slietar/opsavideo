
export class Component {
  constructor() {
    this._refs = {};
    this.refs = new Proxy({}, {
      get: (obj, key) => {
        return this._refs[key];
      },
      set: (obj, key, value) => {
        let element = this._refs[key];

        let appendChild = (value) => {
          if (typeof value === 'number' || typeof value === 'string') {
            element.appendChild(document.createTextNode(value.toString()));
          } else if (typeof value === 'object' && value instanceof Element) {
            element.appendChild(value);
          } else if (typeof value === 'object' && value.self instanceof Element) {
            element.appendChild(value.self);
          } else {
            return false;
          }

          return true;
        };

        if (Array.isArray(value)) {
          element.innerHTML = '';
          return value.every(appendChild);
        } else if (typeof value === 'object' && value instanceof Element) {
          element.parentElement.replaceChild(value, element);
          this._refs[key] = value;
        } else if (typeof value === 'object' && value.self instanceof Element) {
          element.parentElement.replaceChild(value.self, element);
          this._refs[key] = value.self;
        } else {
          element.innerHTML = '';
          return appendChild(value);
        }

        return true;
      }
    });
  }

  renderComponent(ref) {
    this._refs = this.render();

    return ref ? {
      [ref]: this._refs.self,
      self: this._refs.self
    } : this._refs.self;
  }
}


export function createElement(tag, attributes, ...children) {
  let element = document.createElement(tag);
  let refs = { self: element };

  if (attributes !== null) {
    for (let [key, value] of Object.entries(attributes)) {
      if (key === 'ref') {
        refs[value] = element;
      } else if (key.startsWith('on')) {
        element.addEventListener(key.substring(2), value);
      } else {
        element.setAttribute(key, value);
      }
    }
  }

  for (let child of children.flat()) {
    if (child !== null && child !== void 0) {
      if (typeof child === 'number' || typeof child === 'string') {
        element.appendChild(document.createTextNode(child.toString()));
      } else if (typeof child === 'object' && child instanceof Element) {
        element.appendChild(child);
      } else {
        element.appendChild(child.self);
        refs = { ...child, ...refs };
      }
    }
  }

  return refs;
}

