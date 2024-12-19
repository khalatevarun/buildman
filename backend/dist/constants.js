"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.allowedHTMLElements = exports.MODIFICATIONS_TAG_NAME = exports.WORK_DIR = exports.WORK_DIR_NAME = exports.MAX_RESPONSE_SEGMENTS = exports.MAX_TOKENS = void 0;
// see https://docs.anthropic.com/en/docs/about-claude/models
exports.MAX_TOKENS = 8192;
// limits the number of model responses that can be returned in a single request
exports.MAX_RESPONSE_SEGMENTS = 2;
exports.WORK_DIR_NAME = 'project';
exports.WORK_DIR = `/home/${exports.WORK_DIR_NAME}`;
exports.MODIFICATIONS_TAG_NAME = 'bolt_file_modifications';
exports.allowedHTMLElements = [
    'a',
    'b',
    'blockquote',
    'br',
    'code',
    'dd',
    'del',
    'details',
    'div',
    'dl',
    'dt',
    'em',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'i',
    'ins',
    'kbd',
    'li',
    'ol',
    'p',
    'pre',
    'q',
    'rp',
    'rt',
    'ruby',
    's',
    'samp',
    'source',
    'span',
    'strike',
    'strong',
    'sub',
    'summary',
    'sup',
    'table',
    'tbody',
    'td',
    'tfoot',
    'th',
    'thead',
    'tr',
    'ul',
    'var',
];
