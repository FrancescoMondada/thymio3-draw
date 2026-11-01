# Thymio 3 - the drawing mode (blue + yellow, "Painter" in mode.c), in MicroPython.
#
# A port of main/drawer.c of the Thymio 3 firmware (plus the motion helpers it relies on: behavior.c, straight_controller.c,
# angle_controller.c, as in thymio3-cards' sequence mode), so that the robot behaves like the built-in mode, but can be told
# from a web page which figure to draw, and when.
#
# The robot holds a pen in the middle of its axle. Two rows of eight figures, chosen with the arrows:
#   left, right   the figure before / after, in the row         forward, backward   the other row
#   the Lego LEDs count the place in the row: the front row for the polygons, the back row for the shapes
#   a hand put over the two rear sensors and taken away (0.5 s) starts the drawing; the centre button leaves the mode
#   row 1  polygons   line, angle (2 sides of a triangle), triangle, square, pentagon, hexagon, heptagon, octagon
#   row 2  shapes     circle, rectangle, diamond, trapezoid, 5-pointed star, parallelogram, 7-pointed star, figure 8
# While it draws, the buttons do nothing; at the end the circle LEDs blink three times and a sound plays. The body lights show the
# colour the sensor under the robot sees (red, yellow, green, blue, purple, white; the others switch them off).
#
# Movements, like the firmware's:
#   - a side: speed 140 for 6 000 000 hardware timer ticks (1.2 s; the polygons from the hexagon on: half of it), the timer stops the
#     motors by itself, a heading-hold loop on the raw gyro angle keeps the line straight (straight_controller.c, not exposed to
#     MicroPython, so ported here); 0.5 s of pause after a side;
#   - a turn: the firmware angle controller, started with rotate_deg_absolute() on a heading that accumulates the turns (the drift
#     of the sides is cancelled at every turn), at most speed 100, then 10 ticks (0.2 s) of pause;
#   - a circle: one wheel at speed 140, the other stopped, until the gyro says 360 degrees; the figure 8 is two of them.
#
# Differences with the firmware (voulues): the page can choose the figure, start and stop the drawing (the firmware has no way to
# stop one but to leave the mode), set its size (SIZE, in percent: the sides last SIZE % as long, a circle's radius is SIZE % of the
# firmware's, which takes the other wheel from stopped to slower or faster), draw a form of its own (figure 16: a list of sides, each a
# time and the turn that follows it, told by the page), and the mode prints what it does.
#
# The page and the robot talk through stdout and the four body LEDs:
#   robot -> page  "@@word ..." lines, see say(). Every 100 ms: @@n ms state figure step angle left right colour rear_left rear_right
#                  (ms since the mode started, state 0 idle 1 drawing 2 blinking, figure 0..15, step = the figure's step in progress,
#                  angle = the gyro's angle since the drawing began in tenths of a degree, the measured wheel speeds, the colour seen,
#                  the two rear proximity readings, the distance driven since the drawing began: the sum, at every tick, of the two wheels'
#                  measured speeds, 4 x the mean speed x one tick: the speed of the tick before, or the mean of the two when it dropped); @@sel figure; @@draw figure; @@seg step s|t (a side or a pivot begins, a turn begins);
#                  @@rep n (the form's n-th time begins); @@end figure; @@stop; @@size percent; @@cal fw bw rot90; @@state name; @@ack n.
#   page -> robot  rx_poll() below.
import thymio
import time

# written by the page when the whole mode is sent instead of the module (see run())
SEL = 0
GO = 0
SIZE = 100

# ---- constants of the firmware ---------------------------------------------
TICK_MS = 20            # the behaviors run at 50 Hz
MOVE_SPEED = 140        # MOVEMENT_SPEED
ROT_SPEED = 100         # MAX_ROTATION_SPEED2
SIDE_TICKS = 6000000    # DEFAULT_FW_MOTION_DURATION (5 timer ticks per microsecond: 1.2 s)
TICKS_PER_MS = 5000
GUARD_TICKS = 150000    # the last 30 ms of a side belong to the hardware timer
STOP_MS = 500           # pause after a side (behavior.c STOP_DURATION_US)
AFTER_TURN = 10         # DELAY_AFTER_ROTATION, in ticks
HAND_NEAR = 1700        # PROX_THRESHOLD + 200
HAND_FAR = 1300         # PROX_THRESHOLD - 200
LED_DELAY = 15          # LED_ANIMATION_DELAY, in ticks
MAXB = 16               # MAX_BRIGHTNESS
SND_END = 11            # TONE_TYPE_DRAW_END
ROT90_NOMINAL = 16384   # ROTATION_ANGLE_90 (gyro ticks for 90 degrees)
S_KP = 0.1              # straight_controller.c
S_KI = 0.2
S_MAX_I = 1000.0
S_LIMIT = 600.0         # MAX_LIMIT_SPEED
HEARTBEAT_TICKS = 150   # the selection and the state are said again every 3 s
LATE_TICKS = 10         # and 0.2 s after a message of the page (not at once: the start of a drawing says enough already, the line to the page drops the end of a burst)
NET_TICKS = 5           # @@n every 100 ms
SIZE_MIN = 40           # the size, in percent of the firmware's
SIZE_MAX = 300
CUSTOM = 16             # the figure that the page tells: a list of sides
CUSTOM_MAX = 24         # sides
CUSTOM_TICKS = 25000    # a side of the custom form is told in units of 5 ms: 25 000 timer ticks
REPEAT_MAX = 50         # times the custom form is drawn

ST_IDLE = 0
ST_DRAW = 1
ST_BLINK = 2
STATE_NAMES = ("idle", "draw", "blink")

# phases of a drawing (the states of DrawPolygon() and the others in drawer.c)
PH_INIT = 0             # the angle is reset
PH_SIDE = 1             # a side starts
PH_WSIDE = 2            # wait for the side to end, then the turn starts
PH_WTURN = 3            # wait for the turn to end
PH_GO = 4               # a pivot starts
PH_WPIV = 5             # wait for the gyro to say a full turn

# items of a message: 0 the figure (0..16), 1 a command, 2 the size (percent), 3 forget the custom form, 4 a side of it (units of 5 ms:
# a time of 0 is a turn on the spot), 5 the turn (degrees, left is positive) that follows the side that was told last, 6 how many
# times to draw the form (each time from where the last one stopped and in the heading it stopped in: the turn after the last side is the
# angle the form ends with, made at the end of every time)
KEY_SELECT = 0
KEY_COMMAND = 1
KEY_SIZE = 2
KEY_CUSTOM_CLEAR = 3
KEY_CUSTOM_SIDE = 4
KEY_CUSTOM_TURN = 5
KEY_CUSTOM_REPEAT = 6
CMD_START = 1
CMD_STOP = 2
CMD_QUIT = 3
CMD_REPORT = 4

# The sixteen figures, in the order of the robot's menus. A side is ("S", num, den, turn): num/den of the base side, then a turn on
# the spot in degrees (left is positive; 0 ends the figure at once). A pivot is ("P", left, right): the wheels' speeds, until the gyro
# says 360 degrees. From the hexagon on the sides are halved (drawer.c: StepsIndex >= 5). A side of the page's own form is
# ("C", units, turn): units of 5 ms at speed 140, then a turn (0 goes on to the next side with no turn; the last side's turn is the angle
# the form ends with).
def poly(n, turn, den=1):
    return [("S", 1, den, turn)] * n


FIGS = (
    poly(1, 0),                 # 0  line
    poly(2, 120),               # 1  angle
    poly(3, 120),               # 2  triangle
    poly(4, 90),                # 3  square
    poly(5, 72),                # 4  pentagon
    poly(6, 60, 2),             # 5  hexagon
    poly(7, 51, 2),             # 6  heptagon
    poly(8, 45, 2),             # 7  octagon
    [("P", MOVE_SPEED, 0)],     # 8  circle
    [("S", 1, 1, 90), ("S", 3, 2, 90), ("S", 1, 1, 90), ("S", 3, 2, 90)],           # 9  rectangle
    [("S", 1, 1, 120), ("S", 1, 1, 60), ("S", 1, 1, 120), ("S", 1, 1, 60)],         # 10 diamond
    [("S", 1, 1, 42), ("S", 1, 1, 42), ("S", 1, 1, 138), ("S", 5, 2, 138)],         # 11 trapezoid
    poly(5, 144),               # 12 5-pointed star
    [("S", 1, 1, 120), ("S", 3, 2, 60), ("S", 1, 1, 120), ("S", 3, 2, 60)],         # 13 parallelogram
    poly(7, 154),               # 14 7-pointed star
    [("P", MOVE_SPEED, 0), ("P", 0, MOVE_SPEED)],                                   # 15 figure 8
)

# the body lights for a colour the sensor sees (HandleBodyColor: cyan, black and unknown switch them off)
BODY_LIGHT = {"r": (1, 0, 0), "y": (1, 1, 0), "g": (0, 1, 0), "b": (0, 0, 1), "p": (1, 0, 1), "w": (1, 1, 1)}

# ---- hardware ---------------------------------------------------------------
beh = thymio.BEHAVIORS()
mot = thymio.MOTORS()
imu = thymio.IMU()
btn = thymio.BUTTONS()
snd = thymio.SOUND()
rgb = [thymio.LEDS_RGB(i) for i in range(4)]            # FL, FR, BL, BR
circle = [thymio.LEDS_CIRCLE(i) for i in range(8)]
lego_f = [thymio.LEDS_LEGO_FRONT(i) for i in range(8)]
lego_b = [thymio.LEDS_LEGO_BACK(i) for i in range(8)]
prox_bl = thymio.PROXIMITY(5)
prox_br = thymio.PROXIMITY(6)
ground = None           # the colour sensor, made at the first reading (False: this robot has none)


def say(*parts):
    # The firmware sends stdout in batches: at 100 bytes, or after a second without output. A line
    # padded to 100 bytes goes out at once, ended by \x1e (record separator) instead of a newline
    # that would only follow in the next batch.
    s = "@@" + " ".join([str(p) for p in parts])
    print(s + " " * (99 - len(s)) + "\x1e", end="")


def set_body(r, g, b):
    # (the green channel of the front left LED is where the page's messages are told from the mode's own
    # lights: it never shows 15, see rx_poll)
    rgb[0].set_intensity(r, g if g != 15 else 14, b)
    rgb[1].set_intensity(r, g, b)
    rgb[2].set_intensity(r, g, b)
    rgb[3].set_intensity(r, g, b)


def set_circle(v):
    for i in range(8):
        circle[i].intensity(v)


def lego_row(row, n):
    # Leds_SetLegoFrontProgress / BackProgress: the row fills from the right
    for i in range(8):
        row[i].intensity(MAXB if i >= 8 - n else 0)


def play_sound(sound_id):
    try:
        snd.stop()
    except Exception:
        pass
    try:
        snd.play_onboard(sound_id)
    except Exception:
        pass


def clamp_size(size):
    if size < SIZE_MIN:
        return SIZE_MIN
    if size > SIZE_MAX:
        return SIZE_MAX
    return size


def tdiv(a, b):
    # C integer division (truncates toward zero)
    q = abs(a) // abs(b)
    return q if (a < 0) == (b < 0) else -q


def clamp(v, limit):
    if limit < 0:
        limit = -limit
    if v > limit:
        return limit
    if v < -limit:
        return -limit
    return v


def pivot_speeds(left, right, size):
    # A circle with the other wheel stopped is the firmware's (size 100). A bigger one lets that wheel turn forward, a smaller one
    # backward: radius = size % of the firmware's, whatever the speed of the other wheel is.
    if size == 100:
        return left, right
    if left > right:
        return left, tdiv(left * (size - 100), size + 100)
    return tdiv(right * (size - 100), size + 100), right


class Edge:
    # the firmware's when(): true once, on the rising edge of the condition
    def __init__(self):
        self.prev = 0

    def __call__(self, cond):
        c = 1 if cond else 0
        r = c and not self.prev
        self.prev = c
        return r


def ground_color(h, s, v):
    # The colour the sensor sees, from its hue (0..360), saturation and value (0..100): the thresholds of UpdateColor() in
    # main/color_sensor.c, except that a surface that is dark and grey is black here (the firmware calls it unknown). "?" is none of
    # the eight.
    if s < 12:
        if v > 65:
            return "w"
        if v <= 20:
            return "k"
        return "?"
    if v <= 20:
        return "k"
    if h <= 10 or h > 350:
        return "r"
    if h <= 30:
        return "y"
    if h <= 80:
        return "g"
    if h <= 210:
        return "c"
    if h <= 260:
        return "b"
    if h <= 350:
        return "p"
    return "?"


def read_colour():
    global ground
    if ground is False:
        return "?"
    try:
        if ground is None:
            ground = thymio.COLOR_SENSOR()
        h, s, v = ground.get_hsv()
    except Exception:
        ground = False
        return "?"
    return ground_color(h, s, v)


class Drawer:
    def __init__(self, sel, go, size):
        self.sel = sel if 0 <= sel <= CUSTOM else 0
        self.go = go
        self.size = clamp_size(size)
        self.run_size = self.size
        self.custom = []
        self.reps = 1                   # times the custom form is drawn, and the time it is in
        self.run_reps = 1
        self.rep = 0
        self.state = ST_IDLE
        self.quit = False
        self.ticks = 0
        self.t0 = time.ticks_ms()
        # the drawing in progress
        self.fig = None
        self.phase = PH_INIT
        self.k = 0
        self.heading = 0
        self.delay = 0
        # motion
        self.motion_in_progress = False
        self.motion_running = False
        self.t_stop = 0
        self.alarm = 0
        self.last_el = 0
        self.t_move = 0
        self.rot90 = ROT90_NOMINAL + int(imu.get_gyro_scale_calib())
        # straight controller (port of straight_controller.c)
        self.s_on = False
        self.s_target = 0
        self.s_base = 0
        self.s_maxcorr = 0.0
        self.s_int = 0.0
        self.s_last_us = 0
        # lights, the hand, the buttons
        self.pulse = 0
        self.colour = "?"
        self.la_state = 0
        self.la_count = 0
        self.lego_dirty = True
        self.hand_state = 0
        self.hand_count = 0
        self.p5 = 0
        self.p6 = 0
        self.pl = 0                     # the wheels' measured speeds at the last tick
        self.pr = 0
        self.dsum = 0                   # the distance driven since the drawing began (see tick)
        self.beat = 0
        self.e_left = Edge()
        self.e_right = Edge()
        self.e_fwd = Edge()
        self.e_back = Edge()
        self.e_center = Edge()
        # messages of the page (see rx_poll)
        self.rx_msg = -1
        self.rx_got = {}
        self.rx_last = -1

    # ---- reports ---------------------------------------------------------------
    def report_all(self):
        say("sel", self.sel)
        say("size", self.size)
        say("state", STATE_NAMES[self.state])
        self.beat = 0

    def report_n(self):
        say("n", time.ticks_diff(time.ticks_ms(), self.t0), self.state, self.sel, self.k,
            tdiv(imu.get_angle_raw() * 900, self.rot90), self.pl, self.pr,
            self.colour, self.p5, self.p6, self.dsum)

    def set_state(self, state):
        if state != self.state:
            self.state = state
            say("state", STATE_NAMES[state])

    # ---- the page's messages -----------------------------------------------------------
    def select(self, fig):
        if self.state == ST_IDLE and 0 <= fig <= CUSTOM:
            self.change_selection(fig)

    def set_size(self, size):
        size = clamp_size(size)
        if self.state == ST_IDLE and size != self.size:
            self.size = size
            say("size", size)

    def change_selection(self, fig):
        if fig != self.sel:
            self.sel = fig
            self.lego_dirty = True
            say("sel", fig)

    def command(self, code):
        if code == CMD_START:
            if self.state == ST_IDLE:
                self.begin()
        elif code == CMD_STOP:
            if self.state != ST_IDLE:
                self.abort()
        elif code == CMD_QUIT:
            say("exit")
            self.quit = True
        elif code == CMD_REPORT:
            self.report_all()

    def item(self, key, v):
        if key == KEY_SELECT:
            self.select(v)
        elif key == KEY_COMMAND:
            self.command(v)
        elif key == KEY_SIZE:
            self.set_size(v)
        elif key == KEY_CUSTOM_CLEAR:
            self.custom = []
        elif key == KEY_CUSTOM_SIDE:
            if len(self.custom) < CUSTOM_MAX:
                self.custom.append([v & 4095, 0])
        elif key == KEY_CUSTOM_TURN:
            if self.custom:
                self.custom[-1][1] = v
        elif key == KEY_CUSTOM_REPEAT:
            self.reps = 1 if v < 1 else REPEAT_MAX if v > REPEAT_MAX else v

    def rx_poll(self):
        # The page tells the mode what to do: it writes the four body LEDs through the Bluetooth command (the firmware stores
        # what it is given, and these getters read it back). The same channel as the cards and the learning pages. Twelve 4-bit
        # values make a frame:
        #   0 message number, 1 always 15 (the mode never writes 15 on that channel: this is what tells a frame from its own
        #   lights), 2 last-frame flag (8) + frame number, 3..10 eight nibbles of the message, 11 checksum.
        # The message is a number of items (two nibbles) then the items, five nibbles each: a key (two) and a value (three, signed 12
        # bits). Keys: 0 the figure (0..15), 1 a command (CMD_*). Once complete the message is applied and answered by "@@ack n".
        # The mode's next tick puts its own lights back.
        if rgb[0].get_intensity_green() != 15:
            return
        n = []
        for i in range(4):
            led = rgb[i]
            n.append(led.get_intensity_red())
            n.append(led.get_intensity_green())
            n.append(led.get_intensity_blue())
        total = 5
        for i in range(11):
            total += (i + 1) * n[i]
        if (total & 15) != n[11]:
            return
        self.lego_dirty = True          # the frame has set the Lego LEDs too: they are drawn again
        if n[0] != self.rx_msg:
            self.rx_msg = n[0]
            self.rx_got = {}
            self.rx_last = -1
        self.rx_got[n[2] & 7] = n[3:11]
        if n[2] & 8:
            self.rx_last = n[2] & 7
        if self.rx_last < 0:
            return
        stream = []
        for i in range(self.rx_last + 1):
            if i not in self.rx_got:
                return
            stream += self.rx_got[i]
        self.rx_got = {}
        self.rx_last = -1
        count = stream[0] * 16 + stream[1]
        if len(stream) < 2 + 5 * count:
            return
        msg = self.rx_msg
        pos = 2
        for k in range(count):
            key = stream[pos] * 16 + stream[pos + 1]
            v = (stream[pos + 2] << 8) | (stream[pos + 3] << 4) | stream[pos + 4]
            if v >= 2048:
                v -= 4096
            pos += 5
            self.item(key, v)
        say("ack", msg)
        self.beat = HEARTBEAT_TICKS - LATE_TICKS

    # ---- straight controller (straight_controller.c) ----------------------------------
    def straight_start(self, heading_deg, speed):
        self.s_target = tdiv(heading_deg * self.rot90, 90)
        self.s_base = speed
        self.s_maxcorr = float(abs(speed))
        self.s_int = 0.0
        self.s_last_us = time.ticks_us()
        self.s_on = True

    def apply_speeds(self, base, corr):
        left = base - corr
        right = base + corr
        over = (left if left > right else right) - S_LIMIT
        if over > 0:
            left -= over
            right -= over
        under = -S_LIMIT - (left if left < right else right)
        if under > 0:
            left += under
            right += under
        mot.set_speed(int(left - 0.5) if left < 0 else int(left + 0.5),
                      int(right - 0.5) if right < 0 else int(right + 0.5))

    def straight_update(self):
        if not self.s_on:
            return
        if not self.motion_running:
            self.s_on = False
            return
        # the hardware timer ends the side (and stops the motors by itself)
        el = mot.distance_calib_timer_get()
        late = time.ticks_diff(time.ticks_ms(), self.t_move) > self.alarm // TICKS_PER_MS + 150
        done = el >= self.alarm or el < self.last_el or late
        self.last_el = el
        if done:
            self.end_move()
            return
        if el >= self.alarm - GUARD_TICKS:
            return
        now = time.ticks_us()
        dt = time.ticks_diff(now, self.s_last_us) / 1000000.0
        self.s_last_us = now
        if dt <= 0.0 or dt > 0.1:
            dt = 0.02
        err = self.s_target - imu.get_angle_raw()
        self.s_int = clamp(self.s_int + err * dt, S_MAX_I)
        corr = clamp(S_KP * err + S_KI * self.s_int, self.s_maxcorr)
        self.apply_speeds(self.s_base, corr)

    def start_move(self, dur):
        mot.distance_calib_timer_set(dur)
        mot.distance_calib_timer_reset()
        mot.distance_calib_timer_start()
        self.alarm = dur
        self.last_el = 0
        self.t_move = time.ticks_ms()
        self.motion_in_progress = True
        self.motion_running = True
        self.straight_start(self.heading, MOVE_SPEED)
        self.straight_update()

    def end_move(self):
        self.motion_running = False
        self.s_on = False
        mot.set_speed(0, 0)
        mot.distance_calib_timer_pause()
        self.t_stop = time.ticks_ms()

    def rotate_to_next(self, step_deg):
        # RotateToNextHeading(): the target heading accumulates the steps
        self.heading += step_deg
        imu.rotate_deg_absolute(self.heading, ROT_SPEED)

    # ---- starting, stopping ------------------------------------------------------------------
    def begin(self):
        if self.sel == CUSTOM:
            fig = [("C", c[0], c[1]) for c in self.custom]
        else:
            fig = FIGS[self.sel]
        if not fig:                     # a form with no side: nothing to draw
            return
        self.fig = fig
        self.run_size = self.size
        self.run_reps = self.reps if self.sel == CUSTOM else 1
        self.state = ST_DRAW
        say("state", "draw")
        self.phase = PH_INIT
        self.hand_state = 0
        self.hand_count = 0

    def finish(self):
        self.la_count = 0
        self.la_state = 0
        self.phase = PH_INIT
        self.k = 0
        say("end", self.sel)
        self.set_state(ST_BLINK)
        play_sound(SND_END)             # after the line: the audio pipeline can take its time, the page waits for it

    def abort(self):
        # whatever the robot is doing stops: the motors, the timer, a turn under way
        mot.distance_calib_timer_pause()
        mot.set_speed(0, 0)
        imu.rotate_deg(0, 0)
        mot.set_speed(0, 0)
        self.s_on = False
        self.motion_running = False
        self.motion_in_progress = False
        self.phase = PH_INIT
        self.k = 0
        set_circle(0)
        self.lego_dirty = True
        say("stop")
        self.set_state(ST_IDLE)

    # ---- a drawing (drawer.c: DrawPolygon, DrawCircle, DrawRectangle...) ------------------------------
    def draw(self):
        fig = self.fig
        ph = self.phase
        if ph == PH_INIT:
            imu.reset_angle()           # start from 0 degrees
            self.heading = 0
            self.k = 0
            self.rep = 0
            self.dsum = 0
            say("draw", self.sel)
            self.phase = PH_GO if fig[0][0] == "P" else PH_SIDE
        elif ph == PH_SIDE:
            step = fig[self.k]
            say("seg", self.k, "s")
            if step[0] == "S":
                dur = SIDE_TICKS // 100 * step[1] * self.run_size // step[2]
            else:
                dur = step[1] * CUSTOM_TICKS
            if dur > 0:                 # (a side of no time is a turn on the spot)
                self.start_move(dur)
            self.phase = PH_WSIDE
        elif ph == PH_WSIDE:
            if not self.motion_in_progress:
                step = fig[self.k]
                if step[0] == "S":
                    turn = step[3]
                    if turn == 0:       # the line
                        self.finish()
                        return
                else:
                    turn = step[2]
                    if turn == 0:       # no turn: on to the next side, the form's next time, or the end
                        self.next_step()
                        return
                say("seg", self.k, "t")
                self.rotate_to_next(turn)
                self.delay = 0
                self.phase = PH_WTURN
        elif ph == PH_WTURN:
            if imu.rotation_completed():
                self.delay += 1
                if self.delay == AFTER_TURN:
                    self.next_step()
        elif ph == PH_GO:
            step = fig[self.k]
            say("seg", self.k, "s")
            mot.set_speed(*pivot_speeds(step[1], step[2], self.run_size))
            self.delay = 0
            self.phase = PH_WPIV
        elif ph == PH_WPIV:
            if abs(imu.get_angle_deg()) >= 360:
                mot.set_speed(0, 0)
                self.delay += 1
                if self.delay == AFTER_TURN:
                    self.k += 1
                    if self.k == len(fig):
                        self.finish()
                    else:
                        imu.reset_angle()
                        step = fig[self.k]
                        say("seg", self.k, "s")
                        mot.set_speed(*pivot_speeds(step[1], step[2], self.run_size))
                        self.delay = 0

    def next_step(self):
        self.k += 1
        if self.k == len(self.fig):
            if self.rep + 1 >= self.run_reps:
                self.finish()
                return
            self.rep += 1               # the form again
            self.k = 0
            say("rep", self.rep)
        self.phase = PH_GO if self.fig[self.k][0] == "P" else PH_SIDE

    # ---- the LED animation at the end (three blinks of the circle) -----------------------------------
    def blink(self):
        s = self.la_state
        if s == 0:
            set_circle(MAXB)
            self.la_count = 0
            self.la_state = 1
            return
        self.la_count += 1
        if self.la_count >= LED_DELAY:
            self.la_count = 0
            if s & 1:
                set_circle(0)
            else:
                set_circle(MAXB)
            if s == 5:
                self.la_state = 0
                self.set_state(ST_IDLE)
            else:
                self.la_state = s + 1

    # ---- the idle state: the arrows and the hand --------------------------------------------------------
    def hand(self):
        # StartFromProx(): a hand over both rear sensors for 100 ms, then away for 0.5 s
        if self.hand_state == 0:
            if self.p5 > HAND_NEAR and self.p6 > HAND_NEAR:
                self.hand_count += 1
                if self.hand_count == 5:
                    self.hand_state = 1
            else:
                self.hand_count = 0
        elif self.p5 < HAND_FAR and self.p6 < HAND_FAR:
            self.hand_count += 1
            if self.hand_count == 25:
                self.hand_state = 0
                self.hand_count = 0
                return True
        else:
            self.hand_count = 0
        return False

    def idle(self, status):
        s = self.sel
        base = 0 if s < 8 else 8
        if self.e_left(status[1]):
            self.change_selection(base + (s - base + 7) % 8)
            s = self.sel
        if self.e_right(status[4]):
            self.change_selection(base + (s - base + 1) % 8)
        if self.e_fwd(status[3]):
            self.change_selection(8 if self.sel < 8 else 0)
        if self.e_back(status[0]):
            self.change_selection(8 if self.sel < 8 else 0)
        if self.hand():
            self.begin()

    # ---- lights ---------------------------------------------------------------------------
    def body(self):
        # Common_GetBodyColorPulse(): up in 1.3 s, down in 2.6 s
        self.pulse += 1
        if self.pulse > 0:
            b = self.pulse >> 2
            if self.pulse >= (MAXB << 2):
                self.pulse = -(MAXB << 3)
        else:
            b = -(self.pulse >> 3)
        light = BODY_LIGHT.get(self.colour)
        if light:
            set_body(b * light[0], b * light[1], b * light[2])
        else:
            set_body(0, 0, 0)

    def lego(self):
        if self.sel < 8:
            lego_row(lego_f, self.sel + 1)
            lego_row(lego_b, 0)
        else:
            lego_row(lego_f, 0)
            lego_row(lego_b, 0 if self.sel == CUSTOM else self.sel - 7)
        self.lego_dirty = False

    # ---- one tick of the mode (Drawer_Run) -----------------------------------------------------
    def tick(self):
        status = btn.get_status()   # [BACKWARD, LEFT, CENTER, FORWARD, RIGHT]
        if self.e_center(status[2]):
            say("exit")
            self.quit = True
            return
        self.rx_poll()
        if self.quit:
            return
        self.p5 = prox_bl.value()
        self.p6 = prox_br.value()
        self.colour = read_colour()
        self.body()
        if self.state == ST_IDLE:
            if self.go:
                self.go = 0
                self.begin()
            else:
                self.idle(status)
        if self.lego_dirty:
            self.lego()
        if self.state == ST_DRAW:
            self.draw()
        elif self.state == ST_BLINK:
            self.blink()
        self.straight_update()
        if self.motion_in_progress and not self.motion_running:
            if time.ticks_diff(time.ticks_ms(), self.t_stop) >= STOP_MS:
                self.motion_in_progress = False
        # the distance, a tick at a time: a side starts and ends between two of the page's 100 ms readings. The speed that was set at the
        # last tick drove the tick that has just passed; if it has dropped since (the timer stopped the wheels), they stopped half way
        left = mot.get_left_speed()
        right = mot.get_right_speed()
        before = self.pl + self.pr
        after = left + right
        self.dsum += before + after if abs(after) < abs(before) else 2 * before
        self.pl = left
        self.pr = right
        self.ticks += 1
        if self.ticks % NET_TICKS == 0:
            self.report_n()
        self.beat += 1
        if self.beat >= HEARTBEAT_TICKS:
            self.report_all()


def cleanup():
    # whatever happened (centre button, STOP from the page, an error): stop the motors, cancel a turn, switch the LEDs off, give the
    # robot back
    try:
        mot.distance_calib_timer_pause()
        mot.set_speed(0, 0)
        imu.rotate_deg(0, 0)
        mot.set_speed(0, 0)
        set_body(0, 0, 0)
        set_circle(0)
        lego_row(lego_f, 0)
        lego_row(lego_b, 0)
    finally:
        beh.enable_behaviors()
        say("bye")


def run(sel=None, go=None, size=None, custom=None, reps=None):
    # sel: the figure to start with (0..16), go: draw it at once (1) or wait (0), size: in percent (100 is the firmware's), custom: the
    # page's own form as "units:turn,units:turn..." (so that a restart can start with it), reps: the times it is drawn
    if sel is None:
        sel = SEL
    if go is None:
        go = GO
    if size is None:
        size = SIZE
    beh.disable_behaviors()
    beh.enable_leds_proximity()
    try:
        d = Drawer(sel, go, size)
        if custom:
            for part in custom.split(","):
                side = part.split(":")
                if len(d.custom) < CUSTOM_MAX:
                    d.custom.append([int(side[0]) & 4095, int(side[1])])
        if reps:
            d.reps = 1 if reps < 1 else REPEAT_MAX if reps > REPEAT_MAX else reps
        say("hello", 1)
        cal = mot.get_distance_calibration()
        say("cal", int(cal[0]), int(cal[1]), d.rot90)
        say("bat", thymio.get_battery_voltage())
        d.report_all()
        while not d.quit:
            t0 = time.ticks_ms()
            d.tick()
            left = TICK_MS - time.ticks_diff(time.ticks_ms(), t0)
            if left > 0:
                time.sleep_ms(left)
    finally:
        cleanup()
