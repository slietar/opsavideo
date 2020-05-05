
export function defer() {
  let resolve, reject;

  let promise = new Promise((_resolve, _reject) => {
    resolve = _resolve;
    reject = _reject;
  });

  return { promise, resolve, reject };
}


export function hash(str) {
  let hash = 0;

  for (let index = 0; index < str.length; index++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(index);
    hash |= 0;
  }

  return hash;
}

export function hash16(str) {
  return Math.abs(hash(str)).toString(16);
}


export function humanSize(bytes, precision) {
  let mags = ' kMGTPEZY';

  let magnitude = Math.min(Math.log(bytes) / Math.log(1024) | 0, mags.length - 1);
  let result = bytes / Math.pow(1024, magnitude);
  let suffix = mags[magnitude].trim() + 'B';

  return result.toFixed(precision) + ' ' + suffix;
}


export function listen(element, eventType, listener) {
  element.addEventListener(eventType, listener);

  return () => {
    element.removeEventListener(eventType, listener);
  };
}


export function replaceElement(oldElement, newElement) {
  return oldElement.parentElement(newElement, oldElement);
}


export function wait(delay) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve();
    }, delay);
  });
}


export function setImdbImageWidth(url, width) {
  return url.substring(0, url.search('._V1_')) + `._V1_SX${width}_AL_.jpg`;
}

