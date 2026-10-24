## About

Smart Budget is a minimal self hosted docker app for zimaos and casaos

it tracks your income, expenses, and savings goals — categories, charts, a calendar view, and a PIN to keep it private

## How to install

1. make folders and move the files there (u can change the app name if u want)

   /DATA/AppData/smart-budget/app/ ← server/, public/, package.json, package-lock.json go here
   /DATA/AppData/smart-budget/data/ ← leave empty

2. use the [My Budget compose.yaml] on App Store → "Install a Customized App" → Docker Compose tab

3. w8

4. Open http://<your-zimaos-ip>:8090

5. enjoy

# Shadow out

## Offline use

Fonts are bundled locally (public/fonts), so the UI looks the same with no internet.
Internet is only needed once, on first start, to pull the node image and run npm install.
