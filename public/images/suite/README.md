# The six login artworks

Drop the generated PNGs here. The exact filenames the code looks for, and the
prompt that produces each, come from one place:

    npm run art:prompts

Until a file exists, that system's login page renders a gradient in the same
accent instead — so a partly-generated set never looks like a partly-finished
product. Add a file and it appears on the next render; delete it and the
gradient comes back. No rebuild, no code change.

    login-lending.png     Lending Console      #2a78d6
    login-portal.png      Customer Portal      #0e7490
    login-analytics.png   Analytics Studio     #7c3aed
    login-desk.png        ConnectDesk          #be123c
    login-people.png      PeopleHub HR         #6d28d9
    login-books.png       Ledgerly Accounting  #0f766e

The prompts live in `src/lib/suite/artwork.ts`, next to the code that renders
them, so the paths here and the paths the app reads cannot drift apart.
