/**
 * The contract between the daemon and whoever is talking to it.
 *
 * Its own package because of who needs it. The configurator is a browser
 * application: it renders keys, it never opens a socket to a panel or reads a
 * profile off disk — and yet it used to depend on `@easydeck/core`, the daemon
 * itself, purely to learn the shape of a message. The daemon depends on the
 * configurator in turn, because it serves the built page, and the two together
 * made a circle that no build order can satisfy.
 *
 * That circle was invisible on a developer's machine, where whatever was built
 * last time is still lying there, and failed every time on a clean checkout:
 * the two were started at the same moment, and the window lost.
 *
 * So the direction is now the one that was always true. A client depends on
 * the contract; the daemon implements it and serves the client. Nothing here
 * touches Node, and nothing here is a place to put behaviour — if something
 * needs a socket or a disk, it belongs on the other side of this line.
 */

export * from './api-messages.js';
export type * from './payloads.js';

/*
 * And the shapes the protocol carries, from the one place they are defined.
 *
 * A profile, a button, a variable and a picture cross the wire exactly as the
 * engine describes them — so this re-exports rather than restates. Types only:
 * a browser has no use for the engine's machinery, and copying the
 * declarations here would be two descriptions of one thing, free to drift.
 */
export type * from '@easydeck/engine';
