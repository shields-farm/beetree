#!/bin/bash
# Polls FRDR download page via Safari JS until zip is ready, then downloads
# Strict match: only triggers on "Ready" or a download link, NOT "Requested"

MAX_CHECKS=60  # 60 * 2min = 2 hours max
CHECKS=0

while [ $CHECKS -lt $MAX_CHECKS ]; do
  osascript -e 'tell application "Safari" to do JavaScript "window.location.reload()" in current tab of front window' 2>&1
  sleep 5
  
  STATUS=$(osascript -e 'tell application "Safari" to do JavaScript "var text=document.body.innerText;var idx=text.indexOf(\"FRDR_dataset\");text.substring(idx-20,idx+300)" in current tab of front window' 2>&1)
  
  echo "$(date '+%H:%M:%S'): $STATUS" | head -c 200
  echo ""
  
  # Only trigger on Ready/Download link, explicitly exclude "Requested"
  if echo "$STATUS" | grep -qi "Ready" && ! echo "$STATUS" | grep -qi "Requested"; then
    echo "ZIP READY!"
    # Extract download URL
    DL_URL=$(osascript -e 'tell application "Safari" to do JavaScript "var links=document.querySelectorAll(\"a\");var url=\"\";links.forEach(function(a){if(a.href.includes(\".zip\")||a.href.includes(\"getzip\")||a.href.includes(\"downloadzip\"))url=a.href});url" in current tab of front window' 2>&1)
    echo "DOWNLOAD_URL: $DL_URL"
    
    # Start download on build-host
    ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null user@build-host "curl -L -o /data/staging/urban_audio.zip '$DL_URL'" 2>&1 &
    break
  fi
  
  if echo "$STATUS" | grep -qi "Error\|Failed\|Expired"; then
    echo "ZIP CREATION FAILED"
    break
  fi
  
  CHECKS=$((CHECKS+1))
  sleep 120
done