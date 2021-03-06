const fs = require('fs');
const util = require('util');
const { dirname, basename, extname } = require('path');
const cjsxTransform = require('cjsx-codemod/transform');
const decaffeinate = require('decaffeinate');
const jscodeshift = require('jscodeshift');
const createElementTransform = require('react-codemod/transforms/create-element-to-jsx');
const prettier = require('prettier');
const fixTemplateLiteralTransform = require('./fixTemplateLiteralTransform');
const reactClassTransform = require('./reactClassTransform');
const pureComponentTransform = require('./pureComponentTransform');
const CLIEngine = require('./localCLIEngine');

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

const runCodemod = (codemod, options = {}, nullIfUnchanged = false) => ({ source, path }) => ({
  source:
    codemod({ path, source }, { j: jscodeshift, jscodeshift, stats: () => {} }, options) ||
    (!nullIfUnchanged && source),
  path,
});

const runTransform = transform => ({ source, path }) => ({
  source: transform(source),
  path,
});

const cjsxToCoffee = runCodemod(cjsxTransform);

const coffeeToJs = runTransform(
  source =>
    decaffeinate.convert(source, {
      useJSModules: true,
      looseJSModules: true,
    }).code,
);

const convertToCreateElement = runCodemod(createElementTransform, {}, true);

const jsToJsx = ({ source, path }) => {
  const jsxSource = convertToCreateElement({ source, path }).source;
  const ext = jsxSource ? 'jsx' : 'js';

  return {
    source: jsxSource || source,
    path: `${dirname(path)}/${basename(path, extname(path))}.${ext}`,
  };
};

const fixTemplateLiteral = runCodemod(fixTemplateLiteralTransform);

const convertToClass = runCodemod(reactClassTransform, { 'pure-component': true });

const convertToFunctional = runCodemod(pureComponentTransform, {
  useArrows: true,
  destructuring: true,
});

const prettify = runTransform(source =>
  prettier.format(source, {
    singleQuote: true,
    trailingComma: 'all',
  }),
);

const lintFix = ({ source, path }) => {
  if (CLIEngine) {
    const engine = new CLIEngine({ fix: true, cwd: process.cwd() });
    const { results } = engine.executeOnText(source, path);
    if (results.length === 1 && results[0].output) {
      return { source: results[0].output, path };
    }
  }

  return { source, path };
};

const runSteps = (...fns) =>
  fns.reduce((prevFn, nextFn) => value => nextFn(prevFn(value)), value => value);

const convert = runSteps(
  cjsxToCoffee,
  coffeeToJs,
  jsToJsx,
  fixTemplateLiteral,
  convertToClass,
  convertToFunctional,
  prettify,
  lintFix,
);

module.exports = async function convertFile(coffeePath) {
  try {
    const { source, path } = convert({
      source: await readFile(coffeePath, 'utf8'),
      path: coffeePath,
    });

    return source;
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
};
