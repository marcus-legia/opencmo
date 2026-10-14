import assert from "node:assert/strict";

import type { ClipDocument } from "@opencmo/clip-doc";

import { DocumentSession, SaveConflict, type SaveTransport } from "./session";

const doc = (width: number): ClipDocument =>
  ({ version: 1, stage: { children: [{ kind: "scene", id: "s", width, height: 1920, children: [] }] } }) as never;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Call = { version: number; width: number };

function transport(behave: (call: Call) => Promise<void> | void = () => {}) {
  const calls: Call[] = [];
  let version = 1;
  const save: SaveTransport["save"] = async (expected, document) => {
    const call = { version: expected, width: (document.stage.children[0] as { width: number }).width };
    calls.push(call);
    await behave(call);
    version = expected + 1;
    return { version, document_hash: `h${version}` };
  };
  return { calls, save };
}

async function main(): Promise<void> {
  // Lưu gộp: ba lượt sửa sát nhau → một lượt lưu, bản cuối, đúng version.
  {
    const t = transport();
    const session = new DocumentSession({ document: doc(1080), version: 1, documentHash: "h1" }, t, 20);
    session.commit(doc(1000));
    session.commit(doc(1001));
    session.commit(doc(1002));
    assert.equal(session.getState().status, "pending");
    assert.equal(session.getState().documentHash, null, "chưa lưu thì không có hash để Export");
    await wait(60);
    assert.deepEqual(t.calls, [{ version: 1, width: 1002 }]);
    assert.equal(session.getState().status, "saved");
    assert.equal(session.getState().version, 2);
    assert.equal(session.getState().documentHash, "h2");
  }

  // Sửa trong lúc đang lưu → lưu tiếp với version mới, không chen hai lượt.
  {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const t = transport((call) => (call.version === 1 ? gate : undefined));
    const session = new DocumentSession({ document: doc(1080), version: 1, documentHash: null }, t, 5);
    session.commit(doc(1));
    await wait(20);
    assert.equal(session.getState().status, "saving");
    session.commit(doc(2));
    await wait(20);
    assert.equal(t.calls.length, 1, "không có lượt thứ hai khi lượt đầu chưa về");
    release();
    await session.flush();
    assert.deepEqual(t.calls, [{ version: 1, width: 1 }, { version: 2, width: 2 }]);
    assert.equal(session.getState().status, "saved");
  }

  // Undo/Redo: mỗi commit một bước; undo về đúng bản đã lưu thì không lưu gì.
  {
    const t = transport();
    const session = new DocumentSession({ document: doc(1080), version: 1, documentHash: "h1" }, t, 5);
    session.commit(doc(1));
    session.commit(doc(1)); // y hệt → không thành bước
    session.commit(doc(2));
    session.undo();
    assert.equal((session.current.stage.children[0] as { width: number }).width, 1);
    session.undo();
    assert.equal(session.getState().canUndo, false);
    assert.equal(session.getState().status, "saved");
    await wait(20);
    assert.equal(t.calls.length, 0);
    session.redo();
    session.redo();
    assert.equal(session.getState().canRedo, false);
    await session.flush();
    assert.deepEqual(t.calls, [{ version: 1, width: 2 }]);
    session.undo();
    session.commit(doc(3));
    assert.equal(session.getState().canRedo, false, "sửa mới xoá nhánh Redo");
  }

  // history: false — lưu, nhưng không thành bước Undo và không xoá nhánh Redo.
  {
    const t = transport();
    const session = new DocumentSession({ document: doc(1080), version: 1, documentHash: "h1" }, t, 5);
    session.commit(doc(1));
    session.undo();
    session.commit(doc(7), { history: false });
    assert.equal(session.getState().canUndo, false);
    assert.equal(session.getState().canRedo, true);
    await session.flush();
    assert.deepEqual(t.calls, [{ version: 1, width: 7 }]);
  }

  // Bookkeeping after a user edit (voiceover sync): undo takes back the user's edit, redo brings
  // back the state with the bookkeeping in it.
  {
    const t = transport();
    const session = new DocumentSession({ document: doc(1080), version: 1, documentHash: "h1" }, t, 5, () => {});
    session.commit(doc(1));
    await session.transact(() => doc(2), { history: false, origin: "system" });
    session.undo();
    assert.equal((session.current.stage.children[0] as { width: number }).width, 1080);
    session.redo();
    assert.equal((session.current.stage.children[0] as { width: number }).width, 2);
  }

  // Manifest lưu cùng lượt với document, nhưng Undo không lùi nó.
  {
    const sent: unknown[] = [];
    const t: SaveTransport = {
      save: async (expected, _document, manifest) => {
        sent.push(manifest);
        return { version: expected + 1, document_hash: "h" };
      },
    };
    const session = new DocumentSession({ document: doc(1080), version: 1, documentHash: "h1", manifest: { assets: [] } }, t, 5);
    session.commit(session.current, { manifest: { assets: [{ id: "a" }] }, history: false });
    assert.equal(session.getState().canUndo, false, "đổi thư viện không là bước Undo");
    await session.flush();
    assert.deepEqual(sent, [{ assets: [{ id: "a" }] }]);
    session.commit(doc(9));
    session.commit(session.current, { manifest: { assets: [{ id: "b" }] }, history: false });
    session.undo();
    assert.deepEqual(session.currentManifest, { assets: [{ id: "b" }] }, "Undo không xoá file vừa nhập");
    assert.equal((session.current.stage.children[0] as { width: number }).width, 1080);
    await session.flush();
    assert.equal(session.getState().status, "saved");
  }

  // 409: dừng lưu, giữ bản trong tab, adopt mới nhận bản server.
  {
    const t = transport(() => {
      throw new SaveConflict({ version: 7, document: doc(640) });
    });
    const session = new DocumentSession({ document: doc(1080), version: 1, documentHash: "h1" }, t, 5);
    session.commit(doc(1));
    await wait(20);
    assert.equal(session.getState().status, "conflict");
    assert.equal((session.current.stage.children[0] as { width: number }).width, 1);
    session.commit(doc(2));
    await wait(20);
    assert.equal(t.calls.length, 1, "xung đột thì không thử lưu lại");
    await assert.rejects(session.flush(), SaveConflict);
    session.adopt(session.conflictWith!.document, session.conflictWith!.version, "h7");
    assert.equal(session.getState().status, "saved");
    assert.equal(session.getState().version, 7);
    assert.equal(session.getState().canUndo, false);
  }

  // Assistant writes while a library change of the tab is in flight: the 409 is the Assistant's
  // own write, so autosave keeps going and the library change is saved on the new version.
  {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const sent: { version: number; manifest: unknown }[] = [];
    const t: SaveTransport = {
      save: async (expected, _document, manifest) => {
        sent.push({ version: expected, manifest });
        if (expected === 1) {
          await gate;
          throw new SaveConflict({ version: 2, document: doc(500) });
        }
        return { version: expected + 1, document_hash: `h${expected + 1}` };
      },
    };
    const session = new DocumentSession({ document: doc(1080), version: 1, documentHash: "h1", manifest: { assets: [] } }, t, 5);
    session.commit(session.current, { manifest: { assets: [{ id: "done" }] }, history: false });
    await wait(20);
    assert.equal(session.getState().status, "saving");
    session.rebase(doc(500), 2, "h2");
    release();
    await wait(20);
    await session.flush();
    assert.notEqual(session.getState().status, "conflict");
    assert.deepEqual(sent.at(-1), { version: 2, manifest: { assets: [{ id: "done" }] } }, "library saved on top of the Assistant's version");
    assert.equal((session.current.stage.children[0] as { width: number }).width, 500, "the Assistant's document stays");
    assert.equal(session.getState().version, 3);
    assert.equal(session.getState().status, "saved");
  }

  // Library change still waiting for its save when the Assistant's version arrives: it is sent,
  // not marked saved (Export reads generated media from the saved library).
  {
    const sent: { version: number; manifest: unknown }[] = [];
    const t: SaveTransport = {
      save: async (expected, _document, manifest) => {
        sent.push({ version: expected, manifest });
        return { version: expected + 1, document_hash: "h" };
      },
    };
    const session = new DocumentSession({ document: doc(1080), version: 1, documentHash: "h1", manifest: { assets: [] } }, t, 50);
    session.commit(session.current, { manifest: { assets: [{ id: "done" }] }, history: false });
    session.rebase(doc(500), 4, "h4");
    assert.equal(session.getState().status, "pending");
    await session.flush();
    assert.deepEqual(sent, [{ version: 4, manifest: { assets: [{ id: "done" }] } }]);
  }

  // Nothing pending: rebase is just the new version, no save.
  {
    const t = transport();
    const session = new DocumentSession({ document: doc(1080), version: 1, documentHash: "h1" }, t, 5);
    session.rebase(doc(500), 3, "h3");
    await wait(20);
    assert.equal(t.calls.length, 0);
    assert.equal(session.getState().status, "saved");
    assert.equal(session.getState().documentHash, "h3");
  }

  // A save that lands after the version rebased onto is the newest one: no 409 on the next save.
  {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const t = transport((call) => (call.version === 3 ? gate : undefined));
    const session = new DocumentSession({ document: doc(1080), version: 3, documentHash: "h3" }, t, 5);
    session.commit(doc(1));
    await wait(20);
    session.rebase(doc(500), 3, "h3");
    release();
    await session.flush();
    assert.deepEqual(t.calls, [{ version: 3, width: 1 }, { version: 4, width: 500 }]);
    assert.equal(session.getState().status, "saved");
  }

  // The Assistant's version is one Undo step: undo saves the tab's document on the new version,
  // redo brings the Assistant's back, the library never goes back.
  {
    const sent: { version: number; width: number; manifest: unknown }[] = [];
    const t: SaveTransport = {
      save: async (expected, document, manifest) => {
        sent.push({ version: expected, width: (document.stage.children[0] as { width: number }).width, manifest });
        return { version: expected + 1, document_hash: `h${expected + 1}` };
      },
    };
    const session = new DocumentSession({ document: doc(1080), version: 1, documentHash: "h1", manifest: { assets: [] } }, t, 5);
    session.commit(doc(1));
    await session.flush();
    session.rebase(doc(500), 5, "h5");
    assert.equal(session.getState().canUndo, true);
    session.commit(session.current, { manifest: { assets: [{ id: "new" }] }, history: false });
    await session.flush();
    session.undo();
    assert.equal((session.current.stage.children[0] as { width: number }).width, 1, "back to the tab's document");
    assert.deepEqual(session.currentManifest, { assets: [{ id: "new" }] }, "Undo doesn't take the library back");
    assert.equal(session.getState().status, "pending");
    await session.flush();
    assert.deepEqual(sent.at(-1), { version: 6, width: 1, manifest: { assets: [{ id: "new" }] } }, "saved on the new version");
    session.redo();
    assert.equal((session.current.stage.children[0] as { width: number }).width, 500);
    await session.flush();
    assert.equal(sent.at(-1)?.width, 500);
    session.undo();
    session.undo();
    assert.equal((session.current.stage.children[0] as { width: number }).width, 1080, "earlier steps survive the rebase");
    // The same document again is not a step.
    const steps = new DocumentSession({ document: doc(7), version: 1, documentHash: "h1" }, t, 5);
    steps.rebase(doc(7), 2, "h2");
    assert.equal(steps.getState().canUndo, false);
    // `adopt` (conflict, reset) still starts over.
    session.adopt(doc(9), 20, "h20");
    assert.equal(session.getState().canUndo, false);
    assert.equal(session.getState().canRedo, false);
  }

  // One Assistant turn is one Undo step, however many versions it saves.
  {
    const t = transport();
    const width = (session: DocumentSession) => (session.current.stage.children[0] as { width: number }).width;
    const session = new DocumentSession({ document: doc(1080), version: 1, documentHash: "h1" }, t, 5);
    session.commit(doc(1));
    session.rebase(doc(2), 3, "h3", "turn-1");
    session.rebase(doc(3), 4, "h4", "turn-1");
    session.commit(session.current, { manifest: { assets: [{ id: "landed" }] }, history: false });
    session.rebase(doc(4), 5, "h5", "turn-1");
    session.undo();
    assert.equal(width(session), 1, "one Ctrl+Z undoes the whole turn, library saves in between included");
    session.redo();
    assert.equal(width(session), 4, "redo brings the turn's last version back");

    // A user edit in the middle of a turn splits it: the edit stays its own step.
    session.commit(doc(5));
    session.rebase(doc(6), 7, "h7", "turn-2");
    session.commit(doc(7));
    session.rebase(doc(8), 9, "h9", "turn-2");
    session.undo();
    assert.equal(width(session), 7, "the turn's version after the edit is its own step");
    session.undo();
    assert.equal(width(session), 6);
    session.undo();
    assert.equal(width(session), 5, "the turn's first version is a separate step");

    // A different turn (or no group, like the panel's turn Undo) is a new step.
    const next = new DocumentSession({ document: doc(10), version: 1, documentHash: "h1" }, t, 5);
    next.rebase(doc(11), 2, "h2", "turn-1");
    next.rebase(doc(12), 3, "h3", "turn-2");
    next.rebase(doc(13), 4, "h4");
    next.undo();
    assert.equal(width(next), 12);
    next.undo();
    assert.equal(width(next), 11);
    next.undo();
    assert.equal(width(next), 10);
  }

  // Queued writes: two fired in the same tick both land, in order, the second on the first's result.
  {
    const t = transport();
    const session = new DocumentSession({ document: doc(1080), version: 1, documentHash: "h1" }, t, 5, () => {});
    const width = (document: ClipDocument) => (document.stage.children[0] as { width: number }).width;
    const seen: number[] = [];
    const first = session.transact(async (latest) => {
      await wait(10);
      seen.push(width(latest));
      return doc(width(latest) + 1);
    });
    const second = session.transact((latest) => {
      seen.push(width(latest));
      return doc(width(latest) + 1);
    });
    await Promise.all([first, second]);
    assert.deepEqual(seen, [1080, 1081]);
    assert.equal(width(session.current), 1082);
    session.undo();
    assert.equal(width(session.current), 1081, "each write is its own undo step");
  }

  // A throwing write rejects alone; the next one still runs. A no-op write adds no undo step.
  {
    const t = transport();
    const session = new DocumentSession({ document: doc(1080), version: 1, documentHash: "h1" }, t, 5, () => {});
    const failed = session.transact(() => {
      throw new Error("bad op");
    });
    const next = session.transact(() => doc(5));
    await assert.rejects(failed, /bad op/);
    await next;
    assert.equal((session.current.stage.children[0] as { width: number }).width, 5);
    session.undo();
    assert.equal(session.getState().canUndo, false);
    await session.transact((latest) => latest);
    assert.equal(session.getState().canUndo, false, "unchanged document is not an undo step");
    await session.transact((latest) => ({ document: latest, manifest: { assets: [1] } }), { history: false });
    assert.deepEqual(session.currentManifest, { assets: [1] });
    assert.equal(session.getState().canUndo, false);
  }

  // The document changes while a write is awaiting (Undo): the write is rebuilt on the new one.
  {
    const t = transport();
    const session = new DocumentSession({ document: doc(1080), version: 1, documentHash: "h1" }, t, 5, () => {});
    session.commit(doc(1));
    let runs = 0;
    const write = session.transact(async (latest) => {
      runs++;
      await wait(10);
      return doc((latest.stage.children[0] as { width: number }).width + 100);
    });
    await wait(2); // the build is now awaiting
    session.undo();
    await write;
    assert.equal(runs, 2);
    assert.equal((session.current.stage.children[0] as { width: number }).width, 1180, "built on the undone document");
  }

  // An invalid result is refused and leaves the document alone.
  {
    const t = transport();
    const session = new DocumentSession({ document: doc(1080), version: 1, documentHash: "h1" }, t, 5, (document) => {
      if ((document.stage.children[0] as { width: number }).width < 0) throw new Error("invalid");
    });
    await assert.rejects(session.transact(() => doc(-1)), /invalid/);
    assert.equal((session.current.stage.children[0] as { width: number }).width, 1080);
    assert.equal(session.getState().canUndo, false);
  }

  // Lỗi mạng: giữ bản trong tab, lượt sửa sau thử lại.
  {
    let fail = true;
    const t = transport(() => {
      if (fail) throw new Error("Connection lost. Check your internet and try again.");
    });
    const session = new DocumentSession({ document: doc(1080), version: 1, documentHash: "h1" }, t, 5);
    session.commit(doc(1));
    await wait(20);
    assert.equal(session.getState().status, "error");
    assert.match(session.getState().error ?? "", /Connection lost/);
    fail = false;
    await session.flush();
    assert.equal(session.getState().status, "saved");
    assert.equal(t.calls.length, 2);
  }

  console.log("session.check: ok");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
