import type { XTransport } from "./transport";

function notImplemented(name: string) {
  return () => {
    throw new Error(`fakeTransport: ${name} was not stubbed for this test`);
  };
}

/**
 * Builds a fully-stubbed XTransport for tests, so adding a method to the
 * interface doesn't force every existing test's fake transport literal to be
 * updated — only the tests that actually exercise the new method need to
 * override it.
 */
export function fakeTransport(overrides: Partial<XTransport>): XTransport {
  return {
    getMe: notImplemented("getMe"),
    createTweet: notImplemented("createTweet"),
    getTweet: notImplemented("getTweet"),
    searchRecent: notImplemented("searchRecent"),
    userTweets: notImplemented("userTweets"),
    homeTimeline: notImplemented("homeTimeline"),
    listBookmarks: notImplemented("listBookmarks"),
    addBookmark: notImplemented("addBookmark"),
    removeBookmark: notImplemented("removeBookmark"),
    listBookmarkFolders: notImplemented("listBookmarkFolders"),
    createBookmarkFolder: notImplemented("createBookmarkFolder"),
    listBookmarksInFolder: notImplemented("listBookmarksInFolder"),
    addBookmarkToFolder: notImplemented("addBookmarkToFolder"),
    getUserByUsername: notImplemented("getUserByUsername"),
    like: notImplemented("like"),
    unlike: notImplemented("unlike"),
    retweet: notImplemented("retweet"),
    unretweet: notImplemented("unretweet"),
    follow: notImplemented("follow"),
    unfollow: notImplemented("unfollow"),
    deleteTweet: notImplemented("deleteTweet"),
    uploadImage: notImplemented("uploadImage"),
    uploadVideo: notImplemented("uploadVideo"),
    setMediaAltText: notImplemented("setMediaAltText"),
    ...overrides,
  };
}
