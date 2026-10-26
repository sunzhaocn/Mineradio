"""Compile a blank launch screen into a built, unsigned app using Apple's ibtool.

Call after xcodebuild, before packaging/signing the device app or installing the
simulator app. No compiled NIB or executable is patched. A distinct storyboard
name avoids reusing the old logo's cached launch snapshot after an app update.
"""
from pathlib import Path
import hashlib
import plistlib
import subprocess
import tempfile
import xml.etree.ElementTree as ET

STORYBOARD_NAME = 'MineradioBlankLaunchV2'
STORYBOARD = '''<?xml version="1.0" encoding="UTF-8"?>
<document type="com.apple.InterfaceBuilder3.CocoaTouch.Storyboard.XIB" version="3.0" toolsVersion="32700.99.1234"
 targetRuntime="iOS.CocoaTouch" propertyAccessControl="none" useAutolayout="YES"
 launchScreen="YES" useTraitCollections="YES" useSafeAreas="YES" colorMatched="YES"
 initialViewController="local-launch-controller">
  <device id="ipad12_9rounded" orientation="landscape" layout="fullscreen" appearance="dark"/>
  <dependencies>
    <deployment identifier="iOS"/>
    <plugIn identifier="com.apple.InterfaceBuilder.IBCocoaTouchPlugin" version="22684"/>
    <capability name="Safe area layout guides" minToolsVersion="9.0"/>
    <capability name="documents saved in the Xcode 8 format" minToolsVersion="8.0"/>
  </dependencies>
  <scenes>
    <scene sceneID="local-launch-scene">
      <objects>
        <viewController id="local-launch-controller" sceneMemberID="viewController">
          <view key="view" contentMode="scaleToFill" id="local-launch-view">
            <rect key="frame" x="0.0" y="0.0" width="1024" height="768"/>
            <autoresizingMask key="autoresizingMask" widthSizable="YES" heightSizable="YES"/>
            <viewLayoutGuide key="safeArea" id="local-launch-safe-area"/>
            <color key="backgroundColor" red="0.0" green="0.0" blue="0.0" alpha="1"
             colorSpace="custom" customColorSpace="sRGB"/>
          </view>
        </viewController>
        <placeholder placeholderIdentifier="IBFirstResponder" id="local-launch-first-responder"
         userLabel="First Responder" sceneMemberID="firstResponder"/>
      </objects>
    </scene>
  </scenes>
</document>
'''


def install_blank_launch_screen(app, sdk='iphoneos'):
    """Install the same logo-free launch UI for device and simulator builds."""
    if sdk not in ('iphoneos', 'iphonesimulator'):
        raise ValueError('Expected an iOS device or simulator SDK')
    app = Path(app).resolve(strict=True)
    info_path = app / 'Info.plist'
    if app.suffix != '.app' or not info_path.is_file():
        raise ValueError('Expected a built iOS .app with Info.plist')
    info = plistlib.loads(info_path.read_bytes())
    if info.get('CFBundleSupportedPlatforms') != [
            'iPhoneOS' if sdk == 'iphoneos' else 'iPhoneSimulator']:
        raise ValueError('Launch-screen SDK does not match the built application')
    root = ET.fromstring(STORYBOARD)
    if not root.get('toolsVersion') or root.find('./dependencies/deployment') is None:
        raise ValueError('Apple Interface Builder document metadata is required')
    if root.find('.//imageView') is not None or root.find('.//label') is not None:
        raise ValueError('The launch screen must contain no image or wordmark')
    sdk_path = subprocess.check_output(
        ['xcrun', '--sdk', sdk, '--show-sdk-path'], text=True).strip()
    compiled = app / (STORYBOARD_NAME + '.storyboardc')
    with tempfile.TemporaryDirectory(prefix='mineradio-launch-') as directory:
        source = Path(directory) / (STORYBOARD_NAME + '.storyboard')
        source.write_text(STORYBOARD, encoding='utf-8')
        subprocess.run(['xcrun', 'ibtool', '--compile', str(compiled), str(source),
                        '--sdk', sdk_path, '--minimum-deployment-target',
                        str(info.get('MinimumOSVersion', '16.4')),
                        '--target-device', 'ipad', '--target-device', 'iphone',
                        '--errors', '--warnings', '--notices'], check=True)
    if not compiled.is_dir() or not any(compiled.glob('*.nib')):
        raise RuntimeError('Apple ibtool did not produce a compiled launch screen')
    info['UILaunchStoryboardName'] = STORYBOARD_NAME
    for key in ('UILaunchStoryboardName~ipad', 'UILaunchStoryboardName~iphone',
                'UILaunchScreen', 'UILaunchStoryboards'):
        info.pop(key, None)
    info['UIStatusBarHidden'] = True
    # Briefcase 0.3.26's template defaults this key to true. On iPadOS 26
    # that opts into a fixed-size scene scaled inside a user-managed window.
    info['UIRequiresFullScreen'] = False
    info_path.write_bytes(plistlib.dumps(info, fmt=plistlib.FMT_BINARY))
    return dict(storyboard=STORYBOARD_NAME, containsLogo=False, sdk=sdk,
                sourceSHA256=hashlib.sha256(STORYBOARD.encode('utf-8')).hexdigest(),
                fullScreenPolicy='fill-current-window')
