#!/usr/bin/env python3
import sys
import os
import subprocess
import struct

def read_bmp(bmp_path):
    with open(bmp_path, 'rb') as f:
        data = f.read()

    offset = struct.unpack('<I', data[10:14])[0]
    width, height = struct.unpack('<ii', data[18:26])
    bpp = struct.unpack('<H', data[28:30])[0]

    def get_pixel(x, y):
        y_idx = y if height < 0 else (abs(height) - 1 - y)
        row_bytes = width * 4
        idx = offset + y_idx * row_bytes + x * 4
        b, g, r, a = data[idx], data[idx+1], data[idx+2], data[idx+3]
        brightness = 0.299 * r + 0.587 * g + 0.114 * b
        return {'x': x, 'y': y, 'r': r, 'g': g, 'b': b, 'a': a, 'brightness': brightness}

    return width, abs(height), get_pixel

def convert_to_bmp(png_path, bmp_path):
    subprocess.check_call(['sips', '-s', 'format', 'bmp', png_path, '--out', bmp_path], stdout=subprocess.DEVNULL)

def main():
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    build_dir = os.path.join(root_dir, 'build')
    light_png = os.path.join(build_dir, 'icon-light-1024.png')
    dark_png = os.path.join(build_dir, 'icon-dark-1024.png')

    light_bmp = '/tmp/verify-icon-light.bmp'
    dark_bmp = '/tmp/verify-icon-dark.bmp'

    convert_to_bmp(light_png, light_bmp)
    convert_to_bmp(dark_png, dark_bmp)

    _, _, get_light_pixel = read_bmp(light_bmp)
    _, _, get_dark_pixel = read_bmp(dark_bmp)

    print("=== PIXEL BRIGHTNESS VERIFICATION GATE ===")

    # 1. Light Icon Checks
    print("\n[1] Checking Light Icon (build/icon-light-1024.png):")
    light_corner = get_light_pixel(200, 200)
    print(f"  - Squircle Corner (200, 200): RGB({light_corner['r']}, {light_corner['g']}, {light_corner['b']}) -> Brightness = {light_corner['brightness']:.1f}")

    min_light = None
    min_light_b = 999.0
    for y in range(420, 621):
        for x in range(300, 441):
            px = get_light_pixel(x, y)
            if px['a'] > 200 and px['brightness'] < min_light_b:
                min_light_b = px['brightness']
                min_light = px

    print(f"  - Earcup BBox Min Pixel ({min_light['x']}, {min_light['y']}): RGB({min_light['r']}, {min_light['g']}, {min_light['b']}) -> Brightness = {min_light['brightness']:.1f}")

    # 2. Dark Icon Checks
    print("\n[2] Checking Dark Icon (build/icon-dark-1024.png):")
    dark_corner = get_dark_pixel(200, 200)
    print(f"  - Squircle Corner (200, 200): RGB({dark_corner['r']}, {dark_corner['g']}, {dark_corner['b']}) -> Brightness = {dark_corner['brightness']:.1f}")

    max_dark = None
    max_dark_b = -1.0
    for y in range(420, 621):
        for x in range(300, 441):
            px = get_dark_pixel(x, y)
            if px['a'] > 200 and px['brightness'] > max_dark_b:
                max_dark_b = px['brightness']
                max_dark = px

    print(f"  - Earcup BBox Max Pixel ({max_dark['x']}, {max_dark['y']}): RGB({max_dark['r']}, {max_dark['g']}, {max_dark['b']}) -> Brightness = {max_dark['brightness']:.1f}")

    # Clean up temp bmps
    try:
        os.remove(light_bmp)
        os.remove(dark_bmp)
    except:
        pass

    # 3. Assertions
    passed = True
    print("\n[3] Evaluating Assertions:")

    # Assertion 1: Light corner brightness > 200
    if light_corner['brightness'] > 200:
        print(f"  [PASS] Light corner brightness > 200 ({light_corner['brightness']:.1f} > 200)")
    else:
        print(f"  [FAIL] Light corner brightness NOT > 200 ({light_corner['brightness']:.1f} <= 200)")
        passed = False

    # Assertion 2: Light earcup bbox min brightness < 80
    if min_light['brightness'] < 80:
        print(f"  [PASS] Light earcup bbox min brightness < 80 ({min_light['brightness']:.1f} < 80)")
    else:
        print(f"  [FAIL] Light earcup bbox min brightness NOT < 80 ({min_light['brightness']:.1f} >= 80)")
        passed = False

    # Assertion 3: Dark corner brightness < 55
    if dark_corner['brightness'] < 55:
        print(f"  [PASS] Dark corner brightness < 55 ({dark_corner['brightness']:.1f} < 55)")
    else:
        print(f"  [FAIL] Dark corner brightness NOT < 55 ({dark_corner['brightness']:.1f} >= 55)")
        passed = False

    # Assertion 4: Dark earcup bbox max brightness > 190
    if max_dark['brightness'] > 190:
        print(f"  [PASS] Dark earcup bbox max brightness > 190 ({max_dark['brightness']:.1f} > 190)")
    else:
        print(f"  [FAIL] Dark earcup bbox max brightness NOT > 190 ({max_dark['brightness']:.1f} <= 190)")
        passed = False

    if not passed:
        print("\nVerification Gate FAILED! Exiting with code 1.")
        sys.exit(1)

    print("\nVerification Gate PASSED! Exit code 0.")
    sys.exit(0)

if __name__ == '__main__':
    main()
