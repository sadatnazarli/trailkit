Output demo.gif

Set Shell "bash"
Set FontSize 14
Set Width 900
Set Height 500
Set Theme "Catppuccin Mocha"

Type "# Install trailkit"
Enter
Sleep 500ms

Type "npm install trailkit"
Enter
Sleep 2s

Type "# Start the example server"
Enter
Sleep 500ms

Type "npx tsx examples/express-basic/index.ts &"
Enter
Sleep 2s

Type "# Create an invoice"
Enter
Sleep 500ms

Type `curl -s -X POST http://localhost:3000/invoices -H 'Content-Type: application/json' -d '{"amount": 250}' | python3 -m json.tool`
Enter
Sleep 2s

Type "# Query the audit log"
Enter
Sleep 500ms

Type "curl -s http://localhost:3000/audit | python3 -m json.tool"
Enter
Sleep 3s

Type "# Verify hash chain integrity"
Enter
Sleep 500ms

Type "curl -s http://localhost:3000/audit/verify | python3 -m json.tool"
Enter
Sleep 2s

Type "kill %1"
Enter
Sleep 500ms
