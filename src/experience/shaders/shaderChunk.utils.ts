import type { ShaderChunk } from "three"

/** three.js 標準チャンクの名前（common・begin_vertex など） */
type TShaderChunkName = keyof typeof ShaderChunk

/** 標準チャンクを読み込む #include 文 */
const toInclude = (chunkName: TShaderChunkName): string => `#include <${chunkName}>`

/**
 * シェーダーのソース内の標準チャンク（最初の 1 箇所）を、任意の GLSL に置き換える。
 * チャンクが見つからない場合は例外を投げる。three.js の更新でチャンク名が変わったときに、
 * 改変が黙って抜け落ちて見た目だけが壊れるのを防ぐため。
 * MEMO: 差し込む GLSL のコメントに `#include <...>` を書くと、後続の置換がコメント側に当たる。コメントでは「common チャンク」のように書くこと
 * @param source シェーダーのソース（onBeforeCompile の shader.vertexShader / fragmentShader）
 * @param chunkName 置き換える標準チャンクの名前
 * @param code チャンクの代わりに入れる GLSL
 */
export const replaceShaderChunk = (
  source: string,
  chunkName: TShaderChunkName,
  code: string,
): string => {
  const include = toInclude(chunkName)
  if (!source.includes(include)) {
    throw new Error(`シェーダーにチャンク ${include} が見つかりません`)
  }
  // 置換文字列の $& などを特殊パターンとして解釈させないよう、関数で返す
  return source.replace(include, () => code)
}

/**
 * 標準チャンクの直後に GLSL を差し込む（チャンク自体は残す）。
 * チャンクが見つからない場合は例外を投げる（replaceShaderChunk と同じ）
 */
export const insertAfterShaderChunk = (
  source: string,
  chunkName: TShaderChunkName,
  code: string,
): string => replaceShaderChunk(source, chunkName, `${toInclude(chunkName)}\n${code}`)
