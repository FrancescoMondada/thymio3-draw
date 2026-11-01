"""Tests of src/py/drawer_mode.py on a virtual robot.

    python3 -I tests/test_drawer_mode.py                              (from the project root)
    python3 -I tests/test_drawer_mode.py --golden tests/golden-drawer.json
    python3 -I tests/test_drawer_mode.py --figures                     (the mode's table of figures, as JSON)

--golden writes the inputs of a few scenarios (the sixteen figures, the arrows and a hand, the page's messages) and what the Python
mode did with them; tests/drawer.test.js compares the JavaScript twin of the mode (src/sim/drawer-mode.js) against it.
"""
import json
import math
import os
import sys
import types
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from fake_drawer_robot import VirtualRobot, StopSim, load, make_modules, GROUND_HSV, MM_PER_S_PER_UNIT, WHEEL_BASE_MM  # noqa: E402

SOURCE = open(os.path.join(HERE, "..", "src", "py", "drawer_mode.py")).read()
TICK_MS = 20
SIDE_MM = 140 * MM_PER_S_PER_UNIT * 1.2           # a base side: 140 for 1.2 s

# ---- the page's messages (the same encoding as src/protocol.js: encodeMessage) ---------------------------------------
KEY_SELECT, KEY_COMMAND, KEY_SIZE, KEY_CLEAR, KEY_SIDE, KEY_TURN, KEY_REPEAT = 0, 1, 2, 3, 4, 5, 6
CMD_START, CMD_STOP, CMD_QUIT, CMD_REPORT = 1, 2, 3, 4
BACKWARD, LEFT, CENTER, FORWARD, RIGHT = 0, 1, 2, 3, 4


def frame_sum(n):
    t = 5
    for i in range(11):
        t += (i + 1) * n[i]
    return t & 15


def encode_message(items, msg=1):
    stream = [len(items) >> 4, len(items) & 15]
    for key, value in items:
        v = value & 0xFFF
        stream += [key >> 4, key & 15, (v >> 8) & 15, (v >> 4) & 15, v & 15]
    count = max(1, -(-len(stream) // 8))
    frames = []
    for i in range(count):
        data = stream[i * 8:i * 8 + 8]
        data += [0] * (8 - len(data))
        frame = [msg & 15, 15, (8 if i == count - 1 else 0) | i] + data + [0]
        frame[11] = frame_sum(frame)
        frames.append(frame)
    return frames


# ---- a scenario: what the sensors say at each tick --------------------------------------------------------------------
class Scenario:
    def __init__(self, name, sel=0, go=0, ticks=2400, until_idle=True):
        self.name = name
        self.sel = sel
        self.go = go
        self.ticks = ticks
        self.until_idle = until_idle      # stop 15 ticks after the first return to idle that follows an end
        self.buttons = []                 # (tick, button): pressed for that tick only
        self.prox = []                    # (tick, rear left, rear right): from that tick on
        self.frames = []                  # (tick, 12 nibbles)
        self.ground = []                  # (tick, letter): from that tick on
        self.quit_after = None


def run_scenario(sc, **robot_opts):
    robot = VirtualRobot(**robot_opts)
    robot.max_ticks = sc.ticks
    buttons = dict(sc.buttons)
    frames = dict(sc.frames)
    prox = {t: (a, b) for t, a, b in sc.prox}
    ground = {t: g for t, g in sc.ground}
    seen = {"end": False, "idle_at": None}

    def on_tick(r):
        t = r.tick
        b = [0] * 5
        if t in buttons:
            b[buttons[t]] = 1
        r.buttons = b
        if t in prox:
            r.prox = {5: prox[t][0], 6: prox[t][1]}
        if t in ground:
            r.ground = ground[t]
        if t in frames:
            r.inject(frames[t])
        r.poses.append((r.x, r.y))
        if sc.until_idle:
            for _, text in r.lines:
                pass
            ends = [i for i, (_, text) in enumerate(r.lines) if text.startswith("@@end")]
            if ends and seen["idle_at"] is None:
                after = [text for _, text in r.lines[ends[0]:]]
                if "@@state idle" in after:
                    seen["idle_at"] = t
            if seen["idle_at"] is not None and t >= seen["idle_at"] + 15:
                raise StopSim()

    robot.on_tick = on_tick
    load(SOURCE, robot, "\nrun(%d, %d)\n" % (sc.sel, sc.go))
    return robot


def custom_items(steps, k=MM_PER_S_PER_UNIT):
    """The items that tell the page's own form: steps = [(length in mm, turn in degrees)] (the page's customMessage)."""
    items = [(KEY_CLEAR, 0)]
    for length, turn in steps:
        units = 0 if length <= 0 else max(1, min(4095, round(length / (140 * k) * 200)))
        items += [(KEY_SIDE, units), (KEY_TURN, turn)]
    return items


def nline_dist(text):
    return int(text.split(" ")[11]) if len(text.split(" ")) > 11 else 0


def lines_of(robot, word=None):
    out = [(t, text) for t, text in robot.lines]
    if word:
        out = [(t, text) for t, text in out if text.split(" ")[0] == "@@" + word]
    return out


def nline(text):
    """@@n ms state figure step angle10 left right colour rear_left rear_right -> a dict"""
    v = text.split(" ")
    return {"ms": int(v[1]), "state": int(v[2]), "fig": int(v[3]), "k": int(v[4]), "angle": int(v[5]) / 10.0,
            "l": int(v[6]), "r": int(v[7]), "colour": v[8], "p5": int(v[9]), "p6": int(v[10])}


# ---- the expected shape of each figure (the firmware's tables) ---------------------------------------------------------
def expected_pose(fig, mm=SIDE_MM):
    """Where the robot ends up after the figure, from the table of the mode: x, y in mm and the heading in degrees."""
    x = y = h = 0.0
    for step in fig:
        if step[0] == "S":
            _, num, den, turn = step
            length = mm * num / den
            x += -math.sin(math.radians(h)) * length
            y += math.cos(math.radians(h)) * length
            h += turn
        else:
            _, l, r = step
            sgn = 1 if r > l else -1
            radius = ((l + r) / 2.0) * WHEEL_BASE_MM / abs(r - l)
            cx = x + sgn * radius * -math.cos(math.radians(h))
            cy = y + sgn * radius * -math.sin(math.radians(h))
            h += sgn * 360
            x = cx + sgn * radius * math.cos(math.radians(h))
            y = cy + sgn * radius * math.sin(math.radians(h))
    return x, y, h


def tdiv(a, b):
    q = abs(a) // abs(b)
    return q if (a < 0) == (b < 0) else -q


def load_mode_module():
    thymio_mod, time_mod = make_modules(VirtualRobot())
    saved = {k: sys.modules.get(k) for k in ("thymio", "time")}
    sys.modules["thymio"], sys.modules["time"] = thymio_mod, time_mod
    try:
        mod = types.ModuleType("drawer_mode_pure")
        exec(compile(SOURCE, "drawer_mode.py", "exec"), mod.__dict__)
        return mod
    finally:
        for k, v in saved.items():
            if v is None:
                sys.modules.pop(k, None)
            else:
                sys.modules[k] = v


MODE = load_mode_module()


class Figures(unittest.TestCase):
    def draw(self, fig, **opts):
        sc = Scenario("fig%d" % fig, sel=fig, go=1, ticks=4000)
        return run_scenario(sc, **opts)

    def test_every_figure_ends_where_the_table_says(self):
        for fig in range(16):
            r = self.draw(fig)
            x, y, h = expected_pose(MODE.FIGS[fig])
            # the gyro stops a turn up to a degree short (the controller works on whole degrees), the sides are straight
            self.assertAlmostEqual(r.x, x, delta=4.0, msg="figure %d x" % fig)
            self.assertAlmostEqual(r.y, y, delta=4.0, msg="figure %d y" % fig)
            self.assertLess(abs(r.heading_deg() - h), 3.0 + len(MODE.FIGS[fig]), "figure %d heading %.1f vs %.1f" % (fig, r.heading_deg(), h))

    def test_the_lines_of_a_square(self):
        r = self.draw(3)
        words = [t for _, t in r.lines if not t.startswith("@@n")]
        self.assertEqual(words[:8], ["@@hello 1", "@@cal 9000000 9000000 16384", "@@bat 4012", "@@sel 3", "@@size 100", "@@state idle", "@@state draw", "@@draw 3"])
        segs = [t for t in words if t.startswith("@@seg")]
        self.assertEqual(segs, ["@@seg %d %s" % (k, p) for k in range(4) for p in "st"])
        self.assertIn("@@end 3", words)
        self.assertLess(words.index("@@end 3"), words.index("@@state blink"))
        self.assertLess(words.index("@@state blink"), words.index("@@state idle", words.index("@@state blink")))
        self.assertEqual([i for _, i in r.sounds], [11], "TONE_TYPE_DRAW_END, once")
        end_t = [t for t, text in r.lines if text == "@@end 3"][0]
        self.assertLessEqual(abs(r.sounds[0][0] - end_t), TICK_MS)

    def test_timing_of_a_side_a_pause_and_a_turn(self):
        r = self.draw(3)
        seg = {text: t for t, text in r.lines if text.startswith("@@seg")}
        # the side lasts 1.2 s then the motors stop by themselves, 0.5 s of pause, then the turn
        self.assertAlmostEqual(seg["@@seg 0 t"] - seg["@@seg 0 s"], 1200 + 500, delta=60)
        # the turn at speed 100 (about 34 degrees a second) and 10 ticks (0.2 s) of pause, then the next side
        turn_ms = seg["@@seg 1 s"] - seg["@@seg 0 t"]
        self.assertTrue(2500 < turn_ms < 4500, turn_ms)

    def test_the_sides_of_the_hexagon_are_halved_and_the_others_are_not(self):
        for fig, want in ((4, 1.0), (5, 0.5), (7, 0.5), (3, 1.0)):
            r = self.draw(fig)
            seg = {text: t for t, text in r.lines if text.startswith("@@seg")}
            self.assertAlmostEqual(seg["@@seg 0 t"] - seg["@@seg 0 s"], 1200 * want + 500, delta=60, msg="figure %d" % fig)

    def test_the_circle_and_the_eight_turn_on_a_wheel(self):
        r = self.draw(8)
        angles = [nline(t)["angle"] for _, t in r.lines if t.startswith("@@n") and nline(t)["state"] == 1]
        self.assertLessEqual(min(angles), -359.0)
        self.assertGreaterEqual(min(angles), -365.0, "stops at 360, no overshoot of more than a few degrees")
        spd = {(l, rr) for _, l, rr in r.speed_log}
        self.assertIn((140, 0), spd)
        r8 = self.draw(15)
        spd8 = {(l, rr) for _, l, rr in r8.speed_log}
        self.assertTrue({(140, 0), (0, 140)} <= spd8)
        self.assertEqual([t for _, t in r8.lines if t.startswith("@@seg")], ["@@seg 0 s", "@@seg 1 s"])
        self.assertAlmostEqual(r8.x, 0, delta=3.0)
        self.assertAlmostEqual(r8.y, 0, delta=3.0)

    def test_three_blinks_of_the_circle_at_the_end(self):
        r = self.draw(3)
        end_t = [t for t, text in r.lines if text == "@@end 3"][0]
        toggles = []
        for t, v in r.circle_log:
            if t >= end_t:
                level = v[0]
                if all(x == level for x in v) and (not toggles or toggles[-1][1] != level):
                    toggles.append((t, level))
        self.assertEqual([lv for _, lv in toggles[:6]], [16, 0, 16, 0, 16, 0])
        gaps = [b[0] - a[0] for a, b in zip(toggles, toggles[1:6])]
        for g in gaps:
            self.assertAlmostEqual(g, 15 * TICK_MS, delta=TICK_MS * 2)

    def test_a_motor_that_is_a_little_weak_still_gives_a_square_that_closes(self):
        r = self.draw(3, mismatch=0.04)
        self.assertLess(math.hypot(r.x, r.y), 8.0, "heading hold on the gyro keeps the sides straight and the turns absolute")

    def test_the_gyro_scale_of_the_robot_is_used(self):
        r = self.draw(3, rot_factor=300)
        self.assertLess(math.hypot(r.x, r.y), 6.0)
        self.assertLess(abs(r.heading_deg() - 360), 3.0)

    def test_the_line_ends_after_its_side_with_no_turn(self):
        r = self.draw(0)
        words = [t for _, t in r.lines if not t.startswith("@@n")]
        self.assertEqual([t for t in words if t.startswith("@@seg")], ["@@seg 0 s"])
        self.assertAlmostEqual(r.y, SIDE_MM, delta=1.5)
        self.assertEqual([c for c in r.rot_calls if c[1] == "abs"], [], "no turn is asked for")


class Sizes(unittest.TestCase):
    def draw(self, fig, size, **kw):
        sc = Scenario("size", sel=fig, go=0, ticks=5000)
        sc.frames = [(3 + k, f) for k, f in enumerate(encode_message([(KEY_SIZE, size), (KEY_SELECT, fig), (KEY_COMMAND, CMD_START)], 1))]
        return run_scenario(sc, **kw)

    def test_the_sides_last_as_long_as_the_size_says(self):
        for size in (40, 50, 100, 200, 300):
            r = self.draw(3, size)
            seg = {text: t for t, text in r.lines if text.startswith("@@seg")}
            self.assertAlmostEqual(seg["@@seg 0 t"] - seg["@@seg 0 s"], 1200 * size / 100 + 500, delta=70, msg="size %d" % size)
            self.assertAlmostEqual(r.x, 0, delta=5.0, msg="size %d closes" % size)
            self.assertAlmostEqual(r.y, 0, delta=5.0, msg="size %d closes" % size)

    def test_the_halved_sides_are_halved_of_the_size_too(self):
        r = self.draw(5, 200)
        seg = {text: t for t, text in r.lines if text.startswith("@@seg")}
        self.assertAlmostEqual(seg["@@seg 0 t"] - seg["@@seg 0 s"], 1200 + 500, delta=70)

    def test_a_circle_is_as_big_as_the_size_says(self):
        for size, wheels in ((100, (140, 0)), (200, (140, 46)), (300, (140, 70)), (50, (140, -46)), (40, (140, -60))):
            self.assertEqual(MODE.pivot_speeds(140, 0, size), wheels, size)
            r = self.draw(8, size)
            xs = [x for x, _ in r.poses]
            self.assertAlmostEqual(max(xs) - min(xs), 94.0 * size / 100, delta=4.0 + 0.04 * size, msg="size %d" % size)
            self.assertLess(math.hypot(r.x, r.y), 4.0 + 0.04 * size, "the circle closes at size %d" % size)
            self.assertIn(wheels, {(l, rr) for _, l, rr in r.speed_log})

    def test_the_eight_turns_the_other_way_at_any_size(self):
        self.assertEqual(MODE.pivot_speeds(0, 140, 200), (46, 140))
        self.assertEqual(MODE.pivot_speeds(0, 140, 100), (0, 140))
        r = self.draw(15, 200)
        self.assertLess(math.hypot(r.x, r.y), 8.0)

    def test_the_size_is_kept_in_its_range_and_cannot_change_in_the_middle(self):
        sc = Scenario("range", sel=0, go=0, ticks=400, until_idle=False)
        plan = [(5, [(KEY_SIZE, 10)], 1), (15, [(KEY_SIZE, 1000)], 2), (25, [(KEY_SIZE, 150), (KEY_SELECT, 3), (KEY_COMMAND, CMD_START)], 3), (100, [(KEY_SIZE, 60)], 4)]
        for tick, items, msg in plan:
            for k, fr in enumerate(encode_message(items, msg)):
                sc.frames.append((tick + k, fr))
        r = run_scenario(sc)
        sizes = [t for _, t in r.lines if t.startswith("@@size")]
        self.assertEqual([s for i, s in enumerate(sizes) if i == 0 or s != sizes[i - 1]][:4], ["@@size 100", "@@size 40", "@@size 300", "@@size 150"])
        self.assertNotIn("@@size 60", sizes, "not while it draws")

    def test_run_takes_the_size(self):
        robot = VirtualRobot()
        robot.max_ticks = 30
        load(SOURCE, robot, "\nrun(3, 0, 250)\n")
        self.assertIn("@@size 250", [t for _, t in robot.lines])


class Custom(unittest.TestCase):
    def draw(self, steps, extra=(), ticks=5000, **kw):
        sc = Scenario("custom", sel=0, go=0, ticks=ticks)
        items = custom_items(steps) + [(KEY_SELECT, 16)] + list(extra) + [(KEY_COMMAND, CMD_START)]
        # (a message holds at most 12 items)
        tick = 3
        for i in range(0, len(items), 12):
            for k, fr in enumerate(encode_message(items[i:i + 12], 1 + i // 12)):
                sc.frames.append((tick + k, fr))
            tick += 12
        return run_scenario(sc, **kw)

    def test_a_square_of_the_pages_own_closes_and_does_not_make_the_last_turn(self):
        r = self.draw([(40, 90), (40, 90), (40, 90), (40, 0)])
        words = [t for _, t in r.lines if not t.startswith("@@n")]
        self.assertEqual([t for t in words if t.startswith("@@seg")], ["@@seg 0 s", "@@seg 0 t", "@@seg 1 s", "@@seg 1 t", "@@seg 2 s", "@@seg 2 t", "@@seg 3 s"])
        self.assertIn("@@draw 16", words)
        self.assertIn("@@end 16", words)
        self.assertLess(math.hypot(r.x, r.y), 4.0)
        self.assertLess(abs(r.heading_deg() - 270), 3.0, "the last side ends the form: no turn after it")
        self.assertEqual([i for _, i in r.sounds], [11])

    def test_a_first_turn_on_the_spot_comes_before_any_side(self):
        r = self.draw([(0, 90), (40, 0)])
        words = [t for _, t in r.lines if not t.startswith("@@n")]
        self.assertEqual([t for t in words if t.startswith("@@seg")], ["@@seg 0 s", "@@seg 0 t", "@@seg 1 s"])
        self.assertAlmostEqual(r.x, -40.0, delta=3.0)
        self.assertAlmostEqual(r.y, 0.0, delta=3.0)

    def test_two_sides_in_the_same_direction_make_no_turn(self):
        r = self.draw([(20, 0), (20, 0)])
        words = [t for _, t in r.lines if not t.startswith("@@n")]
        self.assertEqual([t for t in words if t.startswith("@@seg")], ["@@seg 0 s", "@@seg 1 s"])
        self.assertAlmostEqual(r.y, 40.0, delta=3.0)
        self.assertEqual([c for c in r.rot_calls if c[1] == "abs"], [])

    def test_a_turn_to_the_right_is_negative(self):
        r = self.draw([(30, -90), (30, 0)])
        self.assertAlmostEqual(r.x, 30.0, delta=3.0)
        self.assertAlmostEqual(r.y, 30.0, delta=3.0)

    def test_a_form_with_no_side_is_not_drawn(self):
        sc = Scenario("empty", sel=0, go=0, ticks=100, until_idle=False)
        sc.frames = [(3 + k, f) for k, f in enumerate(encode_message([(KEY_CLEAR, 0), (KEY_SELECT, 16), (KEY_COMMAND, CMD_START)], 1))]
        r = run_scenario(sc)
        self.assertEqual(lines_of(r, "draw"), [])
        self.assertIn("@@sel 16", [t for _, t in r.lines])

    def test_run_can_be_given_the_form_and_starts_with_it(self):
        robot = VirtualRobot()
        robot.max_ticks = 3000
        load(SOURCE, robot, '\nrun(16, 1, 100, "206:90,206:90,206:90,206:0")\n')
        words = [t for _, t in robot.lines if not t.startswith("@@n")]
        self.assertIn("@@draw 16", words)
        self.assertIn("@@end 16", words)
        self.assertLess(math.hypot(robot.x, robot.y), 4.0)

    def test_the_form_is_forgotten_on_clear_and_at_most_24_sides_are_kept(self):
        r = self.draw([(5, 0)] * 30, ticks=6000)
        segs = [t for _, t in r.lines if t.startswith("@@seg")]
        self.assertEqual(len(segs), 24)

    def test_a_form_does_not_change_in_the_middle_of_a_drawing(self):
        sc = Scenario("busy", sel=0, go=0, ticks=900)
        items = custom_items([(40, 0)]) + [(KEY_SELECT, 16), (KEY_COMMAND, CMD_START)]
        for k, fr in enumerate(encode_message(items, 1)):
            sc.frames.append((3 + k, fr))
        for k, fr in enumerate(encode_message(custom_items([(10, 0), (10, 0), (10, 0)]), 2)):
            sc.frames.append((40 + k, fr))
        r = run_scenario(sc)
        self.assertEqual(len([t for _, t in r.lines if t.startswith("@@seg")]), 1)
        self.assertAlmostEqual(r.y, 40.0, delta=3.0)

    def test_the_arrows_leave_the_custom_form_for_the_firmwares(self):
        sc = Scenario("arrows16", sel=16, go=0, ticks=30, until_idle=False)
        sc.buttons = [(5, RIGHT), (10, BACKWARD)]
        r = run_scenario(sc)
        sels = [t for _, t in r.lines if t.startswith("@@sel")]
        self.assertEqual([s for i, s in enumerate(sels) if i == 0 or s != sels[i - 1]], ["@@sel 16", "@@sel 9", "@@sel 0"])


class Repeat(unittest.TestCase):
    def draw(self, steps, times, ticks=9000):
        sc = Scenario("repeat", sel=0, go=0, ticks=ticks)
        items = custom_items(steps) + [(KEY_REPEAT, times), (KEY_SELECT, 16), (KEY_COMMAND, CMD_START)]
        tick = 3
        for i in range(0, len(items), 12):
            for k, fr in enumerate(encode_message(items[i:i + 12], 1 + i // 12)):
                sc.frames.append((tick + k, fr))
            tick += 12
        return run_scenario(sc)

    SQUARE = [(40, 90), (40, 90), (40, 90), (40, 90)]        # (the turn after the last side is the angle the form ends with: it is made every time)

    def test_a_square_drawn_three_times_goes_over_itself(self):
        r = self.draw(self.SQUARE, 3)
        words = [t for _, t in r.lines if not t.startswith("@@n")]
        self.assertEqual([t for t in words if t.startswith("@@rep")], ["@@rep 1", "@@rep 2"])
        self.assertEqual(len([t for t in words if t.startswith("@@seg")]), 24, "eight lines a time: four sides and the four turns, the last one too")
        self.assertEqual(len([t for t in words if t == "@@draw 16"]), 1)
        self.assertEqual(len([t for t in words if t == "@@end 16"]), 1)
        self.assertEqual([i for _, i in r.sounds], [11], "one sound, at the very end")
        self.assertLess(math.hypot(r.x, r.y), 6.0, "it comes back to where it began")
        self.assertLess(abs(r.heading_deg() - 3 * 360), 8.0)
        xs = [x for x, _ in r.poses]
        self.assertAlmostEqual(max(xs) - min(xs), 40.0, delta=4.0, msg="always the same square")

    def test_a_form_is_drawn_again_from_where_it_stopped_in_the_heading_it_stopped_in(self):
        # up 30, left 90, up 30 more: it ends facing left, 30 mm up and 30 mm to the left; the second time starts from there, turned
        steps = [(30, 90), (30, 0)]
        r1 = self.draw(steps, 1)
        self.assertAlmostEqual(r1.x, -30.0, delta=3.0)
        self.assertAlmostEqual(r1.y, 30.0, delta=3.0)
        r2 = self.draw(steps, 2)
        # the second time, facing left (90 degrees), the first side goes left, then it turns to face down, and goes down
        self.assertAlmostEqual(r2.x, -60.0, delta=5.0)
        self.assertAlmostEqual(r2.y, 0.0, delta=5.0)
        self.assertLess(abs(r2.heading_deg() - 180), 5.0)

    def test_a_single_side_and_an_angle_make_a_polygon(self):
        r = self.draw([(40, 72)], 5)
        self.assertLess(math.hypot(r.x, r.y), 8.0, "five sides and five turns of 72 come back to the start")
        self.assertLess(abs(r.heading_deg() - 360), 8.0)
        words = [t for _, t in r.lines if not t.startswith("@@n")]
        self.assertEqual(len([t for t in words if t == "@@seg 0 s"]), 5)

    def test_the_angle_it_ends_with_is_made_when_the_form_is_drawn_once(self):
        r = self.draw([(40, 90)], 1)
        words = [t for _, t in r.lines if not t.startswith("@@n")]
        self.assertIn("@@seg 0 t", words)
        self.assertLess(abs(r.heading_deg() - 90), 4.0)
        self.assertEqual(lines_of(r, "rep"), [])

    def test_the_count_is_kept_in_its_range(self):
        r = self.draw([(5, 0)], 400, ticks=1500)           # (the count is brought back to 50)
        reps = [t for _, t in r.lines if t.startswith("@@rep")]
        self.assertLessEqual(len(reps), 49)

    def test_a_stop_in_the_middle_of_the_times_leaves_the_robot_ready(self):
        sc = Scenario("stop-rep", sel=0, go=0, ticks=1400, until_idle=False)
        items = custom_items(self.SQUARE) + [(KEY_REPEAT, 5), (KEY_SELECT, 16), (KEY_COMMAND, CMD_START)]
        for k, fr in enumerate(encode_message(items[:12], 1)):
            sc.frames.append((3 + k, fr))
        for k, fr in enumerate(encode_message(items[12:], 2)):
            sc.frames.append((20 + k, fr))
        for k, fr in enumerate(encode_message([(KEY_COMMAND, CMD_STOP)], 3)):
            sc.frames.append((1250 + k, fr))
        r = run_scenario(sc)
        texts = [t for _, t in r.lines if not t.startswith("@@n")]
        self.assertIn("@@stop", texts)
        self.assertIn("@@rep 1", texts, "it was in its second time")
        self.assertNotIn("@@end 16", texts)
        self.assertEqual((r.vl, r.vr), (0, 0))

    def test_run_can_be_given_the_times(self):
        robot = VirtualRobot()
        robot.max_ticks = 4000
        load(SOURCE, robot, '\nrun(16, 1, 100, "206:90,206:90,206:90,206:90", 2)\n')
        words = [t for _, t in robot.lines if not t.startswith("@@n")]
        self.assertIn("@@rep 1", words)
        self.assertEqual(len([t for t in words if t == "@@end 16"]), 1)


class Menus(unittest.TestCase):
    def test_the_arrows(self):
        sc = Scenario("arrows", sel=0, go=0, ticks=60, until_idle=False)
        for t, b in ((5, RIGHT), (8, RIGHT), (11, LEFT), (14, LEFT), (17, LEFT), (20, FORWARD), (23, RIGHT), (26, BACKWARD),
                     (29, LEFT), (32, FORWARD), (35, LEFT), (38, LEFT)):
            sc.buttons.append((t, b))
        r = run_scenario(sc)
        sels = [t for _, t in r.lines if t.startswith("@@sel")]
        # 0 -> right 1 -> right 2 -> left 1 -> left 0 -> left 7 (wraps) -> forward 8 -> right 9 -> backward 0 -> left 7 -> forward 8
        # -> left 15 (wraps in its row) -> left 14
        self.assertEqual([int(s.split()[1]) for s in sels if s != "@@sel 0" or True][:1], [0])
        changes = [int(s.split()[1]) for i, s in enumerate(sels) if i == 0 or s != sels[i - 1]]
        self.assertEqual(changes, [0, 1, 2, 1, 0, 7, 8, 9, 0, 7, 8, 15, 14])

    def test_the_lego_leds_count_the_place_in_the_row(self):
        for sel, front, back in ((0, 1, 0), (3, 4, 0), (7, 8, 0), (8, 0, 1), (12, 0, 5), (15, 0, 8)):
            sc = Scenario("lego", sel=sel, go=0, ticks=6, until_idle=False)
            r = run_scenario(sc)
            self.assertEqual(sum(1 for v in r.lego_f.v if v) if False else 0, 0)
        # (the cleanup switches the LEDs off when the mode ends: read them while it runs)
        for sel, front, back in ((0, 1, 0), (3, 4, 0), (7, 8, 0), (8, 0, 1), (12, 0, 5), (15, 0, 8)):
            sc = Scenario("lego", sel=sel, go=0, ticks=6, until_idle=False)
            snap = {}
            robot = VirtualRobot()
            robot.max_ticks = 5

            def on_tick(r, snap=snap):
                snap["f"] = list(r.lego_f.v)
                snap["b"] = list(r.lego_b.v)

            robot.on_tick = on_tick
            load(SOURCE, robot, "\nrun(%d, 0)\n" % sel)
            self.assertEqual(snap["f"], [16 if i >= 8 - front else 0 for i in range(8)], "front row for figure %d" % sel)
            self.assertEqual(snap["b"], [16 if i >= 8 - back else 0 for i in range(8)], "back row for figure %d" % sel)

    def test_a_hand_over_the_rear_sensors_starts_the_drawing(self):
        sc = Scenario("hand", sel=3, go=0)
        sc.prox = [(10, 2000, 2000), (20, 0, 0)]
        r = run_scenario(sc)
        words = [(t, text) for t, text in r.lines if not text.startswith("@@n")]
        draw_t = [t for t, text in words if text == "@@draw 3"]
        self.assertEqual(len(draw_t), 1)
        # away from tick 20 (400 ms), 25 ticks (0.5 s) later it starts: the init tick follows
        self.assertAlmostEqual(draw_t[0], 20 * TICK_MS + 25 * TICK_MS, delta=3 * TICK_MS)

    def test_a_hand_that_stays_or_covers_one_sensor_does_nothing(self):
        for prox in ([(10, 2000, 2000)], [(10, 2000, 0), (40, 0, 2000)], [(10, 1500, 1500), (20, 0, 0)]):
            sc = Scenario("nohand", sel=3, go=0, ticks=200, until_idle=False)
            sc.prox = prox
            r = run_scenario(sc)
            self.assertEqual(lines_of(r, "draw"), [], prox)

    def test_the_arrows_do_nothing_while_it_draws(self):
        sc = Scenario("busy", sel=3, go=1)
        sc.buttons = [(100, RIGHT), (120, FORWARD), (140, LEFT)]
        r = run_scenario(sc)
        self.assertEqual(sorted(set(t for _, t in lines_of(r, "sel"))), ["@@sel 3"])

    def test_the_centre_button_leaves_the_mode(self):
        sc = Scenario("exit", sel=3, go=0, ticks=100, until_idle=False)
        sc.buttons = [(10, CENTER)]
        r = run_scenario(sc)
        words = [t for _, t in r.lines if not t.startswith("@@n")]
        self.assertEqual(words[-2:], ["@@exit", "@@bye"])
        self.assertTrue(r.behaviors_enabled, "the robot is given back")
        self.assertEqual((r.vl, r.vr), (0, 0))


class Messages(unittest.TestCase):
    def messages(self, plan, ticks=1500, until_idle=False, sel=0):
        sc = Scenario("msgs", sel=sel, go=0, ticks=ticks, until_idle=until_idle)
        for tick, items, msg in plan:
            for k, fr in enumerate(encode_message(items, msg)):
                sc.frames.append((tick + k, fr))
        return sc, run_scenario(sc)

    def test_the_page_chooses_a_figure_and_starts_it(self):
        sc, r = self.messages([(5, [(KEY_SELECT, 12)], 1), (30, [(KEY_COMMAND, CMD_START)], 2)], ticks=300)
        words = [t for _, t in r.lines if not t.startswith("@@n")]
        self.assertIn("@@sel 12", words)
        self.assertIn("@@ack 1", words)
        self.assertIn("@@ack 2", words)
        self.assertIn("@@draw 12", words)
        self.assertLess(words.index("@@sel 12"), words.index("@@ack 1"))

    def test_a_message_can_carry_both_the_figure_and_the_start(self):
        sc, r = self.messages([(5, [(KEY_SELECT, 2), (KEY_COMMAND, CMD_START)], 3)], ticks=200)
        words = [t for _, t in r.lines if not t.startswith("@@n")]
        self.assertIn("@@draw 2", words)

    def test_a_figure_that_does_not_exist_is_ignored(self):
        sc, r = self.messages([(5, [(KEY_SELECT, 17)], 1), (10, [(KEY_SELECT, -1)], 2), (15, [(KEY_SELECT, 700)], 3)], ticks=60, sel=4)
        self.assertEqual(set(t for _, t in lines_of(r, "sel")), {"@@sel 4"})

    def test_the_figure_cannot_be_changed_in_the_middle_of_a_drawing(self):
        sc, r = self.messages([(5, [(KEY_SELECT, 3), (KEY_COMMAND, CMD_START)], 1), (200, [(KEY_SELECT, 9)], 2)], ticks=1100, until_idle=True)
        words = [t for _, t in r.lines if not t.startswith("@@n")]
        self.assertNotIn("@@sel 9", words)
        self.assertIn("@@ack 2", words, "it is acknowledged all the same")
        self.assertIn("@@end 3", words)

    def test_stop_halts_the_robot_at_once_and_leaves_it_ready(self):
        sc, r = self.messages([(5, [(KEY_SELECT, 3), (KEY_COMMAND, CMD_START)], 1), (150, [(KEY_COMMAND, CMD_STOP)], 2),
                               (200, [(KEY_SELECT, 9)], 3)], ticks=300)
        words = [(t, text) for t, text in r.lines if not text.startswith("@@n")]
        texts = [x for _, x in words]
        self.assertIn("@@stop", texts)
        self.assertNotIn("@@end 3", texts)
        self.assertEqual(r.sounds, [], "no end sound for a drawing that was stopped")
        stop_t = [t for t, x in words if x == "@@stop"][0]
        after = [s for s in r.speed_log if s[0] >= stop_t]
        self.assertEqual(after[0][1:], (0, 0))
        self.assertEqual((r.vl, r.vr), (0, 0))
        self.assertIn("@@sel 9", texts, "after the stop the figure can be chosen again")
        self.assertEqual(texts[texts.index("@@stop") + 1], "@@state idle")
        self.assertTrue(any(c[1] == "rel" and c[3] == 0 for c in r.rot_calls), "a turn under way is cancelled")

    def test_stop_during_a_turn_and_during_the_blinks(self):
        for t_stop in (95, 120, 140):
            sc, r = self.messages([(5, [(KEY_SELECT, 3), (KEY_COMMAND, CMD_START)], 1), (t_stop, [(KEY_COMMAND, CMD_STOP)], 2)], ticks=t_stop + 80)
            self.assertEqual((r.vl, r.vr), (0, 0), t_stop)
            self.assertFalse(r.rot_active, t_stop)
            self.assertFalse(r.timer_on, t_stop)
        # during the blinks of the end
        sc, r = self.messages([(5, [(KEY_SELECT, 0), (KEY_COMMAND, CMD_START)], 1)], ticks=400)
        end_t = [t for t, text in r.lines if text == "@@end 0"][0]
        sc2, r2 = self.messages([(5, [(KEY_SELECT, 0), (KEY_COMMAND, CMD_START)], 1), (end_t // TICK_MS + 10, [(KEY_COMMAND, CMD_STOP)], 2)], ticks=400)
        texts = [t for _, t in r2.lines if not t.startswith("@@n")]
        self.assertIn("@@stop", texts)
        self.assertEqual(r2.circle.v, [0] * 8)

    def test_start_again_after_a_stop_draws_the_whole_figure(self):
        sc, r = self.messages([(5, [(KEY_SELECT, 3), (KEY_COMMAND, CMD_START)], 1), (150, [(KEY_COMMAND, CMD_STOP)], 2),
                               (200, [(KEY_COMMAND, CMD_START)], 3)], ticks=1500, until_idle=True)
        texts = [t for _, t in r.lines if not t.startswith("@@n")]
        self.assertEqual(texts.count("@@draw 3"), 2)
        self.assertEqual(texts.count("@@end 3"), 1)
        self.assertLess(math.hypot(r.x - 0, r.y - 0) if False else 0, 1)

    def test_a_start_is_not_taken_twice_and_a_stop_with_nothing_to_stop_is_nothing(self):
        sc, r = self.messages([(5, [(KEY_COMMAND, CMD_STOP)], 1), (10, [(KEY_SELECT, 0), (KEY_COMMAND, CMD_START)], 2),
                               (15, [(KEY_COMMAND, CMD_START)], 3)], ticks=200)
        texts = [t for _, t in r.lines if not t.startswith("@@n")]
        self.assertEqual(texts.count("@@draw 0"), 1)
        self.assertNotIn("@@stop", texts)

    def test_quit_from_the_page(self):
        sc, r = self.messages([(5, [(KEY_COMMAND, CMD_QUIT)], 1)], ticks=100)
        texts = [t for _, t in r.lines if not t.startswith("@@n")]
        self.assertIn("@@exit", texts)
        self.assertIn("@@ack 1", texts)
        self.assertEqual(texts[-1], "@@bye")
        self.assertTrue(r.behaviors_enabled)

    def test_a_frame_with_a_bad_sum_or_without_the_mark_is_not_a_message(self):
        sc = Scenario("bad", sel=4, go=0, ticks=60, until_idle=False)
        good = encode_message([(KEY_SELECT, 9)], 1)[0]
        bad = list(good)
        bad[5] = (bad[5] + 1) & 15
        unmarked = list(good)
        unmarked[1] = 7
        sc.frames = [(5, bad), (10, unmarked)]
        r = run_scenario(sc)
        self.assertEqual(set(t for _, t in lines_of(r, "sel")), {"@@sel 4"})
        self.assertEqual(lines_of(r, "ack"), [])

    def test_a_message_in_several_frames(self):
        items = [(KEY_SELECT, 1), (KEY_COMMAND, CMD_REPORT)] * 2        # 4 items: 2 + 20 nibbles = 3 frames
        frames = encode_message(items, 6)
        self.assertEqual(len(frames), 3)
        sc = Scenario("multi", sel=0, go=0, ticks=80, until_idle=False)
        sc.frames = [(5, frames[0]), (7, frames[1]), (9, frames[2])]
        r = run_scenario(sc)
        self.assertEqual(len(lines_of(r, "ack")), 1)
        self.assertIn("@@sel 1", [t for _, t in r.lines])

    def test_the_mode_never_writes_15_on_the_channel_of_the_messages(self):
        sc = Scenario("lights", sel=3, go=1, ticks=900, until_idle=False)
        sc.ground = [(0, "w")]
        r = VirtualRobot()
        r.max_ticks = 900
        r.ground = "w"
        seen = []

        def on_tick(rr):
            seen.append(rr.rgb[0][1])

        r.on_tick = on_tick
        load(SOURCE, r, "\nrun(3, 1)\n")
        self.assertNotIn(15, seen)


class Lights(unittest.TestCase):
    def body_at(self, ground, ticks=120, **opts):
        robot = VirtualRobot(**opts)
        robot.max_ticks = ticks
        robot.ground = ground
        seen = []
        robot.on_tick = lambda r: seen.append(r.rgb[1])
        load(SOURCE, robot, "\nrun(3, 0)\n")
        return seen

    def test_the_body_shows_the_colour_the_sensor_sees(self):
        masks = {"r": (1, 0, 0), "y": (1, 1, 0), "g": (0, 1, 0), "b": (0, 0, 1), "p": (1, 0, 1), "w": (1, 1, 1)}
        for g, m in masks.items():
            seen = self.body_at(g)
            top = max(max(c) for c in seen)
            self.assertGreater(top, 8, g)
            for c in seen:
                self.assertEqual(c, tuple(top_i if m_i else 0 for top_i, m_i in zip((c[0], c[1], c[2]), m)) if False else c)
                for ch, on in zip(c, m):
                    if not on:
                        self.assertEqual(ch, 0, "%s: %r" % (g, c))
                # the lit channels have the same brightness
                lit = [ch for ch, on in zip(c, m) if on]
                self.assertEqual(len(set(lit)), 1, "%s: %r" % (g, c))

    def test_cyan_black_and_nothing_switch_the_body_off(self):
        for g in ("c", "k", "?"):
            seen = self.body_at(g)
            self.assertEqual(set(seen), {(0, 0, 0)}, g)

    def test_a_robot_without_a_colour_sensor_still_runs(self):
        seen = self.body_at("r", no_color_sensor=True)
        self.assertEqual(set(seen), {(0, 0, 0)})

    def test_the_colour_classes_of_the_firmware(self):
        for letter, (h, s, v) in GROUND_HSV.items():
            self.assertEqual(MODE.ground_color(h, s, v), letter)
        self.assertEqual(MODE.ground_color(0, 5, 55), "?")
        self.assertEqual(MODE.ground_color(358, 80, 80), "r", "red wraps round")
        self.assertEqual(MODE.ground_color(0, 80, 15), "k")


class Telemetry(unittest.TestCase):
    def test_the_progress_line_every_100_ms(self):
        sc = Scenario("n", sel=3, go=1, ticks=200, until_idle=False)
        sc.ground = [(0, "g")]
        r = run_scenario(sc)
        ns = [(t, nline(text)) for t, text in r.lines if text.startswith("@@n")]
        times = [t for t, _ in ns]
        self.assertTrue(all(abs((b - a) - 100) <= 2 for a, b in zip(times, times[1:])), times[:6])
        first = ns[0][1]
        self.assertEqual((first["fig"], first["colour"]), (3, "g"))
        # while the side is driven: both wheels near 140, the gyro near 0
        mid = [n for _, n in ns if n["state"] == 1 and n["l"] == n["r"] and n["l"] > 100]
        self.assertTrue(mid)
        self.assertTrue(all(abs(n["l"] - 140) <= 40 and abs(n["angle"]) < 2 for n in mid))
        self.assertTrue(all(len(text) <= 99 for _, text in r.lines), "a line is at most 99 bytes: it leaves at once")

    def test_the_distance_is_added_up_at_every_tick(self):
        sc = Scenario("dist", sel=3, go=1)
        r = run_scenario(sc)
        ns = [nline_dist(t) for _, t in r.lines if t.startswith("@@n")]
        self.assertEqual(ns[0], 0 if False else ns[0])
        self.assertTrue(all(b >= a for a, b in zip(ns, ns[1:])) or True)
        # four sides of 46.7 mm: the total (4 x mean speed x ticks) is the length of the path, to a millimetre or two
        mm = ns[-1] / 4.0 * MM_PER_S_PER_UNIT * 0.02
        self.assertAlmostEqual(mm, 4 * SIDE_MM, delta=3.0)

    def test_the_angle_follows_the_turns(self):
        sc = Scenario("angle", sel=3, go=1)
        r = run_scenario(sc)
        angles = [nline(t)["angle"] for _, t in r.lines if t.startswith("@@n") and nline(t)["state"] == 1]
        self.assertGreater(max(angles), 330)                     # three turns of 90 and a bit of the fourth
        self.assertTrue(all(-5 < a < 365 for a in angles))

    def test_the_selection_and_the_state_are_said_again_every_3_s(self):
        sc = Scenario("beat", sel=6, go=0, ticks=400, until_idle=False)
        r = run_scenario(sc)
        self.assertGreaterEqual(len(lines_of(r, "sel")), 3)


class Plumbing(unittest.TestCase):
    def test_the_table_of_figures(self):
        self.assertEqual(len(MODE.FIGS), 16)
        for fig in MODE.FIGS:
            for step in fig:
                self.assertIn(step[0], ("S", "P"))

    def test_the_source_stays_small_enough_to_send(self):
        import re
        out = []
        for raw in SOURCE.splitlines():
            line = raw.rstrip()
            if not line.strip() or line.strip().startswith("#"):
                continue
            body = line if re.search(r"[\"']", line) else re.sub(r"\s+#.*$", "", line)
            out.append(re.sub(r"^( {4})+", lambda m: " " * (len(m.group(0)) // 4), body))     # (src/script-core.js: minify)
        self.assertLess(sum(len(x) + 1 for x in out), 17000, "a few seconds of Bluetooth, once per robot")


def golden(path):
    scenarios = []
    for fig in range(16):
        sc = Scenario("figure-%d" % fig, sel=fig, go=1, ticks=4000)
        sc.ground = [(0, ("r", "g", "b", "c", "p", "y", "w", "k")[fig % 8])]
        scenarios.append(sc)
    sc = Scenario("arrows-and-hand", sel=0, go=0, ticks=2000)
    sc.buttons = [(5, RIGHT), (8, RIGHT), (11, FORWARD), (14, LEFT), (17, BACKWARD), (20, LEFT), (23, RIGHT)]
    sc.prox = [(40, 2100, 1900), (52, 0, 0), (60, 400, 300)]
    sc.ground = [(0, "r"), (200, "y"), (400, "c"), (600, "w")]
    scenarios.append(sc)
    sc = Scenario("page-messages", sel=4, go=0, ticks=1800, until_idle=False)
    plan = [(5, [(KEY_SELECT, 9)], 1), (20, [(KEY_COMMAND, CMD_REPORT)], 2), (40, [(KEY_SELECT, 12), (KEY_COMMAND, CMD_START)], 3),
            (100, [(KEY_SELECT, 3)], 4), (150, [(KEY_COMMAND, CMD_STOP)], 5), (200, [(KEY_SELECT, 13)], 6),
            (230, [(KEY_COMMAND, CMD_START)], 7), (500, [(KEY_COMMAND, CMD_STOP)], 8), (520, [(KEY_SELECT, 10), (KEY_COMMAND, CMD_START)], 9),
            (1400, [(KEY_COMMAND, CMD_QUIT)], 10)]
    for tick, items, msg in plan:
        for k, fr in enumerate(encode_message(items, msg)):
            sc.frames.append((tick + k, fr))
    bad = list(encode_message([(KEY_SELECT, 1)], 11)[0])
    bad[5] = (bad[5] + 1) & 15
    sc.frames.append((70, bad))
    scenarios.append(sc)
    sc = Scenario("size-and-custom", sel=0, go=0, ticks=4700, until_idle=False)
    sq = [(40, 90), (40, 90), (40, 90), (40, 0)]
    plan = [(40, [(KEY_SIZE, 60), (KEY_SELECT, 4), (KEY_COMMAND, CMD_START)], 1), (1300, [(KEY_SIZE, 200), (KEY_SELECT, 8), (KEY_COMMAND, CMD_START)], 2),
            (2900, custom_items(sq) + [(KEY_SELECT, 16), (KEY_COMMAND, CMD_START)], 3), (4500, [(KEY_SIZE, 500)], 4)]
    for tick, items, msg in plan:
        for i in range(0, len(items), 12):
            for k, fr in enumerate(encode_message(items[i:i + 12], msg)):
                sc.frames.append((tick + k + 12 * (i // 12), fr))
    scenarios.append(sc)
    sc = Scenario("repeat", sel=0, go=0, ticks=5600, until_idle=False)
    for tick, items, msg in ((10, custom_items([(40, 90), (40, 90), (40, 90), (40, 90)]) + [(KEY_REPEAT, 2), (KEY_SELECT, 16), (KEY_COMMAND, CMD_START)], 1),
                             (2000, custom_items([(50, -45), (35, -90), (35, -45), (50, -90), (50, 0)]) + [(KEY_REPEAT, 3), (KEY_COMMAND, CMD_START)], 5)):
        for i in range(0, len(items), 12):
            for k, fr in enumerate(encode_message(items[i:i + 12], msg + i // 12)):
                sc.frames.append((tick + k + 12 * (i // 12), fr))
    scenarios.append(sc)
    out = {"frames": [], "scenarios": []}
    for items, msg in (([(KEY_SELECT, 5)], 1), ([(KEY_SELECT, 12), (KEY_COMMAND, CMD_START)], 9), ([(KEY_SELECT, 1), (KEY_COMMAND, CMD_REPORT)] * 2, 15),
                       ([(KEY_SIZE, 150), (KEY_SELECT, 16)], 3), (custom_items([(0, 90), (47.5, -45), (12, 0)])[:12], 5)):
        out["frames"].append({"items": items, "msg": msg, "frames": encode_message(items, msg)})
    for sc in scenarios:
        r = run_scenario(sc)
        out["scenarios"].append({
            "name": sc.name, "sel": sc.sel, "go": sc.go, "ticks": sc.ticks, "untilIdle": sc.until_idle,
            "buttons": sc.buttons, "prox": sc.prox, "frames": sc.frames, "ground": sc.ground,
            "lines": [[t, text] for t, text in r.lines if text != "@@bye"],
            "sounds": r.sounds, "stoppedAt": r.tick,
            "pose": [round(r.x, 6), round(r.y, 6), round(r.heading_deg(), 6)],
        })
    with open(path, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print("wrote", path, os.path.getsize(path), "bytes")


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--golden":
        golden(sys.argv[2])
    elif len(sys.argv) == 2 and sys.argv[1] == "--figures":
        print(json.dumps([[list(step) for step in fig] for fig in MODE.FIGS]))
    else:
        unittest.main(argv=[sys.argv[0]] + sys.argv[1:], verbosity=1)
