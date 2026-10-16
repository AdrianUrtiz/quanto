Copy the contents of res/ into your Android app's src/main/res/ directory.
Set android:icon="@mipmap/ic_launcher" in AndroidManifest.xml.
Adaptive foreground works best with a transparent source logo. Keep key artwork in the centered 66 x 66dp reference area of the 108 x 108dp layer. Inspect launcher masks and test the installed app before publishing.
The 512px Play Store PNG is separate from launcher resources.
