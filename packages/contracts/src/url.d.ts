// The WHATWG URL class exists in Node and in browsers, but not in the
// ES2024 lib. This package runs in both, so it takes neither the DOM nor
// the Node types: only the part of URL that push.ts reads.
declare class URL {
  constructor(input: string);
  readonly protocol: string;
  readonly hostname: string;
  readonly port: string;
  readonly username: string;
  readonly password: string;
}
