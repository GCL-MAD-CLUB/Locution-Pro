import assert from "node:assert/strict";
import test from "node:test";

import * as importBrowser from "../../src/components/panels/ImportWorkspace/browser/importBrowserModel.ts";

test("fileExtension reads the extension after the final dot", () => {
  assert.equal(importBrowser.fileExtension("C:\\media\\clip.MP4"), "mp4");
  assert.equal(importBrowser.fileExtension("/media/clip.tar.gz"), "gz");
  assert.equal(importBrowser.fileExtension("clip.mkv"), "mkv");
  assert.equal(importBrowser.fileExtension("README"), "");
  assert.equal(importBrowser.fileExtension(".gitignore"), "");
});

test("mediaKind recognizes every supported media category", () => {
  assert.equal(importBrowser.mediaKind("C:\\media\\clip.mp4"), "video");
  assert.equal(importBrowser.mediaKind("/media/take.WAV"), "audio");
  assert.equal(importBrowser.mediaKind("/media/frame.webp"), "image");
  assert.equal(importBrowser.mediaKind("/media/captions.srt"), "subtitle");
  assert.equal(importBrowser.mediaKind("/media/notes.txt"), null);
  assert.equal(importBrowser.mediaKind("/media/folder"), null);
});

// Independent list: a broken parser or accidental removal must fail for each format.
for (const [kind, extensions] of Object.entries({
  video: "mkv mp4 mov webm avi ts m2ts mts mpeg mpg m4v",
  audio: "wav mp3 m4a aac flac ogg opus wma aiff",
  image: "jpg jpeg png webp bmp tif tiff gif",
  subtitle: "srt ass ssa vtt webvtt",
})) {
  for (const ext of extensions.split(" ")) {
    test(`recognizes ${kind} .${ext} in Windows, UNC and POSIX paths`, () => {
      for (const root of ["C:\\素材.v2\\", "\\\\server\\素材\\", "/素材.v2/"])
        for (const extension of [ext, ext.toUpperCase()]) {
          const path = `${root}镜头.02.${extension}`;
          assert.equal(importBrowser.fileExtension(path), ext, path);
          assert.equal(importBrowser.mediaKind(path), kind, path);
        }
    });
  }
}

test("extension parsing cannot mistake a directory dot or unsupported suffix for media", () => {
  for (const path of [
    "",
    "C:/media.mp4/README",
    "C:\\media.mp4\\README",
    "clip.mp4.bak",
    "clip.mp4.",
    ".mp4",
    "folder/",
    "clip.txt",
    "clipmp4",
  ])
    assert.equal(importBrowser.mediaKind(path), null, path);
});

test("Windows identity ignores slash, case and trailing separators while POSIX keeps case", () => {
  assert.equal(
    importBrowser.pathKey("C:\\Media\\CLIP.mp4"),
    importBrowser.pathKey("c:/media/clip.mp4/"),
  );
  assert.equal(
    importBrowser.pathKey("\\\\SERVER\\Share\\"),
    importBrowser.pathKey("\\\\server\\share"),
  );
  assert.notEqual(
    importBrowser.pathKey("/Media/clip.mp4"),
    importBrowser.pathKey("/media/clip.mp4"),
  );
});

test("breadcrumbs and parents preserve filesystem roots", () => {
  assert.deepEqual(importBrowser.breadcrumbs("C:\\media\\take"), [
    { name: "C:", path: "C:\\" },
    { name: "media", path: "C:\\media" },
    { name: "take", path: "C:\\media\\take" },
  ]);
  assert.equal(importBrowser.parentDirectory("C:\\media"), "C:\\");
  assert.equal(importBrowser.parentDirectory("/media/clip"), "/media");
  assert.equal(importBrowser.parentDirectory("/"), "");
});
