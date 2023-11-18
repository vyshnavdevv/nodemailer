const express = require("express");
const app = express();
const path = require("path");
const { authenticate } = require("@google-cloud/local-auth");
const { google } = require("googleapis");

const port = 3000;
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.labels",
  "https://mail.google.com/",
];
const labelName = "Vacation Auto-Reply";

// Load credentials from file
const credentialsPath = path.join(__dirname, "credentials.json");
const credentials = require(credentialsPath);

app.get("/", async (req, res) => {
  try {
    // Authenticate using Google GMAIL
    const auth = await authenticate({
      keyfilePath: credentialsPath,
      scopes: SCOPES,
    });

    // Get authorized Gmail client
    const gmail = google.gmail({ version: "v1", auth });

    // Find all available labels on current Gmail
    const response = await gmail.users.labels.list({
      userId: "me",
    });

    // Function to find unread or unreplied messages
    async function getUnrepliedMessages(auth) {
      const response = await gmail.users.messages.list({
        userId: "me",
        labelIds: ["INBOX"],
        q: "is:unread",
      });
      return response.data.messages || [];
    }

    // Function to generate the label ID
    async function createLabel(auth) {
      try {
        const response = await gmail.users.labels.create({
          userId: "me",
          requestBody: {
            name: labelName,
            labelListVisibility: "labelShow",
            messageListVisibility: "show",
          },
        });
        return response.data.id;
      } catch (error) {
        if (error.code === 409) {
          const response = await gmail.users.labels.list({
            userId: "me",
          });
          const label = response.data.labels.find(
            (label) => label.name === labelName
          );
          return label.id;
        } else {
          throw error;
        }
      }
    }

    // Main function to handle auto-reply
    async function main() {
      const labelId = await createLabel(auth);

      // Repeat in random intervals
      setInterval(async () => {
        const messages = await getUnrepliedMessages(auth);

        if (messages && messages.length > 0) {
          for (const message of messages) {
            const messageData = await gmail.users.messages.get({
              auth,
              userId: "me",
              id: message.id,
            });

            const email = messageData.data;
            const hasReplied = email.payload.headers.some(
              (header) => header.name === "In-Reply-To"
            );

            if (!hasReplied) {
              // Craft the reply message
              const replyMessage = {
                userId: "me",
                resource: {
                  raw: Buffer.from(
                    `To: ${
                      email.payload.headers.find(
                        (header) => header.name === "From"
                      ).value
                    }\r\n` +
                      `Subject: Re: ${
                        email.payload.headers.find(
                          (header) => header.name === "Subject"
                        ).value
                      }\r\n` +
                      `Content-Type: text/plain; charset="UTF-8"\r\n` +
                      `Content-Transfer-Encoding: 7bit\r\n\r\n` +
                      `Thank you for your message! I'm currently out of the office on vacation and will respond to your email as soon as I return. Your patience is appreciated\r\n`
                  ).toString("base64"),
                },
              };

              await gmail.users.messages.send(replyMessage);

              // Add label and move the email
              await gmail.users.messages.modify({
                auth,
                userId: "me",
                id: message.id,
                resource: {
                  addLabelIds: [labelId],
                  removeLabelIds: ["INBOX"],
                },
              });
            }
          }
        }
      }, Math.floor(Math.random() * (120 - 45 + 1) + 45) * 1000);
    }

    main();

    res.json({ "this is Auth": auth });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
