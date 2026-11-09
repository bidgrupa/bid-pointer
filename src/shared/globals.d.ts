declare module '*.css' {
  const text: string;
  export default text;
}

/** Injected by build.mjs: the same id in every script of one build (see BUILD there). */
declare const __POINTER_BUILD__: string;

/** Injected by build.mjs: which browser family this build is for. */
declare const __POINTER_BROWSER__: 'chrome' | 'firefox' | 'safari';
