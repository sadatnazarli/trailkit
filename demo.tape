Output demo.gif

Set Shell "bash"
Set FontSize 14
Set Width 1000
Set Height 550
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "cd /Users/sadatnazarli/Documents/Projects/trailkit"
Enter
Sleep 500ms
Type "kill $(lsof -ti:3000) 2>/dev/null; true"
Enter
Sleep 500ms
Type "npx tsx examples/express-basic/index.ts &"
Enter
Sleep 3s
Type "clear"
Enter
Sleep 500ms
Show

Type "# Create an audit event"
Enter
Sleep 1s
Type `curl -s -X POST localhost:3000/invoices -H 'Content-Type: application/json' -d '{"amount":250}' | python3 -m json.tool`
Enter
Sleep 2s

Type "# Query the audit log"
Enter
Sleep 1s
Type "curl -s localhost:3000/audit | python3 -m json.tool"
Enter
Sleep 3s

Type "# Verify hash chain integrity"
Enter
Sleep 1s
Type "curl -s localhost:3000/audit/verify | python3 -m json.tool"
Enter
Sleep 3s

Hide
Type "kill %1 2>/dev/null"
Enter
Show
