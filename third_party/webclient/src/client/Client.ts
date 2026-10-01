// RuneSkate stub: the export tools only need the render/config classes, and the few of those that touch the
// game client read nothing but its animation clock. The real client (UI, networking) is not vendored.
export class Client {
    static loopCycle = 0;
}
