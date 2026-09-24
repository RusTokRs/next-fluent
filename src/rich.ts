import React from 'react';
import type { RichTranslationValues } from './types';

interface ASTNode {
  tag?: string;
  children: (React.ReactNode | string)[];
}

const VOID_TAGS = new Set([
  'br',
  'hr',
  'img',
  'input',
  'wbr',
]);

export const REACT_ELEMENT_TOKEN_PREFIX = '\uE000NF_EL_';
export const REACT_ELEMENT_TOKEN_SUFFIX = '_\uE001';

export function createReactElementToken(key: string): string {
  return `${REACT_ELEMENT_TOKEN_PREFIX}${key}${REACT_ELEMENT_TOKEN_SUFFIX}`;
}

const TOKEN_OR_TAG_PATTERN =
  '(?:\\u2068)?\\uE000NF_EL_([a-zA-Z0-9_-]+)_\\uE001(?:\\u2069)?|<\\/?([a-zA-Z][a-zA-Z0-9_-]*)\\s*\\/?>';

/**
 * Parses a formatted string containing markup tags (e.g. `<link>text</link>`, `<br/>`, `<br>`)
 * and embedded React element tokens, mapping them to React elements or tag render functions in `values`.
 */
export function parseRichText(
  text: string,
  values?: RichTranslationValues
): React.ReactNode {
  if (!values) {
    return text;
  }

  const hasTokens = text.includes(REACT_ELEMENT_TOKEN_PREFIX);
  const hasTags = text.includes('<');

  if (!hasTokens && !hasTags) {
    return text;
  }

  const hasInteractive = Object.keys(values).some(
    (k) => typeof values[k] === 'function' || React.isValidElement(values[k])
  );
  if (!hasInteractive) {
    return text;
  }

  const root: ASTNode = { children: [] };
  const stack: ASTNode[] = [root];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const regex = new RegExp(TOKEN_OR_TAG_PATTERN, 'g');

  while ((match = regex.exec(text)) !== null) {
    const [fullMatch, elementTokenKey, tagName] = match;
    const matchIndex = match.index;

    // Push preceding text chunk
    if (matchIndex > lastIndex) {
      const textChunk = text.slice(lastIndex, matchIndex);
      stack[stack.length - 1].children.push(textChunk);
    }
    lastIndex = regex.lastIndex;

    // Case 1: Interpolated React element variable token
    if (elementTokenKey) {
      if (Object.hasOwn(values, elementTokenKey)) {
        const val = values[elementTokenKey];
        if (React.isValidElement(val)) {
          stack[stack.length - 1].children.push(val);
        } else if (typeof val === 'function') {
          stack[stack.length - 1].children.push((val as any)(null));
        } else if (val !== undefined && val !== null) {
          stack[stack.length - 1].children.push(String(val));
        }
      } else {
        stack[stack.length - 1].children.push(fullMatch);
      }
      continue;
    }

    // Case 2: XML / HTML markup tag
    if (tagName) {
      const isClose = fullMatch.startsWith('</');
      const isSelfClosing =
        fullMatch.endsWith('/>') || VOID_TAGS.has(tagName.toLowerCase());

      if (isSelfClosing && !isClose) {
        if (Object.hasOwn(values, tagName)) {
          const renderFnOrEl = values[tagName];
          if (typeof renderFnOrEl === 'function') {
            stack[stack.length - 1].children.push(renderFnOrEl(null));
          } else if (React.isValidElement(renderFnOrEl)) {
            stack[stack.length - 1].children.push(renderFnOrEl);
          } else {
            stack[stack.length - 1].children.push(fullMatch);
          }
        } else {
          stack[stack.length - 1].children.push(fullMatch);
        }
      } else if (isClose) {
        if (stack.length > 1 && stack[stack.length - 1].tag === tagName) {
          const finishedNode = stack.pop()!;
          const renderFnOrEl = Object.hasOwn(values, tagName)
            ? values[tagName]
            : undefined;
          const innerChildren =
            finishedNode.children.length === 1
              ? finishedNode.children[0]
              : React.createElement(React.Fragment, null, ...finishedNode.children);

          if (typeof renderFnOrEl === 'function') {
            stack[stack.length - 1].children.push(renderFnOrEl(innerChildren));
          } else if (React.isValidElement(renderFnOrEl)) {
            stack[stack.length - 1].children.push(
              React.cloneElement(renderFnOrEl, undefined, innerChildren)
            );
          } else {
            stack[stack.length - 1].children.push(
              `<${tagName}>`,
              innerChildren,
              `</${tagName}>`
            );
          }
        } else {
          stack[stack.length - 1].children.push(fullMatch);
        }
      } else {
        // Open tag
        if (Object.hasOwn(values, tagName)) {
          stack.push({ tag: tagName, children: [] });
        } else {
          stack[stack.length - 1].children.push(fullMatch);
        }
      }
    }
  }

  // Push trailing text
  if (lastIndex < text.length) {
    stack[stack.length - 1].children.push(text.slice(lastIndex));
  }

  // Unclosed tags
  while (stack.length > 1) {
    const unclosed = stack.pop()!;
    stack[stack.length - 1].children.push(
      `<${unclosed.tag}>`,
      ...unclosed.children
    );
  }

  if (root.children.length === 0) return '';
  if (root.children.length === 1) return root.children[0];
  return React.createElement(React.Fragment, null, ...root.children);
}
