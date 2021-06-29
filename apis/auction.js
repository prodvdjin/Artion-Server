require("dotenv").config();
const router = require("express").Router();
const service_auth = require("./middleware/auth.tracker");
const mongoose = require("mongoose");
const Auction = mongoose.model("Auction");
const Account = mongoose.model("Account");
const Bid = mongoose.model("Bid");
const NFTITEM = mongoose.model("NFTITEM");
const Collection = mongoose.model("Collection");
const TradeHistory = mongoose.model("TradeHistory");

const sendEmail = require("../mailer/auctionMailer");

const toLowerCase = (val) => {
  if (val) return val.toLowerCase();
  else return val;
};

const parseToFTM = (inWei) => {
  return parseFloat(inWei.toString()) / 10 ** 18;
};

const getCollectionName = async (address) => {
  try {
    let collection = await Collection.findOne({
      erc721Address: toLowerCase(address),
    });
    if (collection) return collection.collectionName;
    else return address;
  } catch (error) {
    return address;
  }
};

const get721ItemName = async (nft, tokenID) => {
  try {
    let token = await NFTITEM.findOne({
      contractAddress: toLowerCase(nft),
      tokenID: tokenID,
    });
    if (token) return token.name;
    else return tokenID;
  } catch (error) {
    return tokenID;
  }
};

const getUserAlias = async (walletAddress) => {
  try {
    let account = await Account.findOne({ address: walletAddress });
    if (account) return account.alias;
    else return walletAddress;
  } catch (error) {
    return walletAddress;
  }
};

const getAuctionEndTime = async (sc, nftAddress, tokenID) => {
  try {
    let auction = await sc.getAuction(nftAddress, tokenID);
    if (auction) {
      return new Date(parseInt(auction._endTime.toString()) * 1000);
    } else return null;
  } catch (error) {
    return null;
  }
};

const convertTime = (value) => {
  return parseFloat(value) * 1000;
};

router.post("/auctionCreated", service_auth, async (req, res) => {
  try {
    let nftAddress = req.body.nftAddress;
    let tokenID = req.body.tokenID;
    nftAddress = toLowerCase(nftAddress);
    tokenID = parseInt(tokenID);
    try {
      await Auction.deleteMany({
        minter: nftAddress,
        tokenID: tokenID,
      });
      let auction = new Auction();
      auction.minter = nftAddress;
      auction.tokenID = tokenID;
      auction.bidder = 0;
      await auction.save();
    } catch (error) {}
    // update sale ends time
    try {
      let token = await NFTITEM.findOne({
        contractAddress: nftAddress,
        tokenID: tokenID,
      });
      if (token) {
        let endTime = await getAuctionEndTime(auctionSC, nftAddress, tokenID);
        token.saleEndsAt = endTime;
        await token.save();
      }
    } catch (error) {}
  } catch (error) {
    return res.status(400);
  } finally {
    return res.json({});
  }
});

router.post("updateAuctionStartTime", service_auth, async (req, res) => {
  try {
    let nftAddress = req.body.nftAddress;
    let tokenID = req.body.tokenID;
    let startTime = convertTime(req.body.startTime);
    nftAddress = toLowerCase(nftAddress);
    tokenID = parseInt(tokenID);
    try {
      let auction = await Auction.findOne({
        minter: toLowerCase(nftAddress),
        tokenID: tokenID,
      });
      if (auction) {
        auction.startTime = startTime;
        await auction.save();
      }
    } catch (error) {}
  } catch (error) {
    return res.status(400).json({});
  } finally {
    return res.json({});
  }
});

router.post("updateAuctionEndTime", service_auth, async (req, res) => {
  try {
    let nftAddress = req.body.nftAddress;
    let tokenID = req.body.tokenID;
    let endTime = convertTime(req.body.endTime);
    nftAddress = toLowerCase(nftAddress);
    tokenID = parseInt(tokenID);
    // update saleEndsAt for 721 tk
    try {
      let tk = await NFTITEM.findOne({
        contractAddress: nftAddress,
        tokenID: tokenID,
      });
      if (tk) {
        tk.saleEndsAt = endTime;
        await tk.save();
      }
    } catch (error) {}
    try {
      let auction = await Auction.findOne({
        minter: toLowerCase(nftAddress),
        tokenID: tokenID,
      });
      if (auction) {
        auction.endTime = endTime;
        await auction.save();
      }
    } catch (error) {}
  } catch (error) {
    return res.status(400).json({});
  } finally {
    return res.json({});
  }
});

router.post("/updateAuctionReservePrice", service_auth, async (req, res) => {
  try {
    let nftAddress = req.body.nftAddress;
    let tokenID = req.body.tokenID;
    let reservePrice = req.body.reservePrice;
    nftAddress = toLowerCase(nftAddress);
    reservePrice = parseToFTM(reservePrice);
    tokenID = parseInt(tokenID);
    let bid = await Bid.findOne({
      minter: nftAddress,
      tokenID: tokenID,
    });
    if (bid) {
      let bidder = toLowerCase(bid.bidder);
      let account = await Account.findOne({ address: bidder });

      if (account) {
        let to = account.email;
        let alias = account.alias;
        let collectionName = await getCollectionName(nftAddress);
        let tokenName = await get721ItemName(nftAddress, tokenID);
        let data = {
          type: "auction",
          to: to,
          event: "UpdateAuctionReservePrice",
          subject: "NFT Auction Price Updated",
          alias: alias,
          collectionName: collectionName,
          tokenName: tokenName,
          tokenID: tokenID,
          nftAddress: nftAddress,
          newPrice: reservePrice,
        };
        sendEmail(data);
      }
    }
  } catch (error) {
    return res.status(400).json({});
  } finally {
    return res.json({});
  }
});

router.post("/bidPlaced", service_auth, async (req, res) => {
  try {
    let nftAddress = req.body.nftAddress;
    let tokenID = req.body.tokenID;
    let bidder = req.body.bidder;
    let bid = req.body.bid;
    nftAddress = toLowerCase(nftAddress);
    bidder = toLowerCase(bidder);
    bid = parseToFTM(bid);
    tokenID = parseInt(tokenID);
    try {
      let tk = await NFTITEM.findOne({
        tokenID: tokenID,
        contractAddress: nftAddress,
      });

      // there is only 1 bidder, the top bidder will be the only one who is selected
      if (tk) {
        let address = tk.owner;
        let account = await Account.findOne({ address: address });
        if (account) {
          let to = account.email;
          let alias = account.alias;
          let collectionName = await getCollectionName(nftAddress);
          let tokenName = await get721ItemName(nftAddress, tokenID);
          let bidderAlias = await getUserAlias(bidder);
          let data = {
            type: "auction",
            to: to,
            event: "BidPlaced",
            subject: "You got a bid for your item!",
            alias: alias,
            bidderAlias: bidderAlias,
            collectionName: collectionName,
            tokenName: tokenName,
            tokenID: tokenID,
            nftAddress: nftAddress,
            bid: bid,
          };
          sendEmail(data);
        }
      }
      await Bid.deleteMany({
        minter: nftAddress,
        tokenID: tokenID,
      });
      let newBid = new Bid();
      newBid.minter = nftAddress;
      newBid.tokenID = tokenID;
      newBid.bidder = bidder;
      newBid.bid = bid;
      await newBid.save();
    } catch (error) {}
  } catch (error) {
    return res.status(400).json({});
  } finally {
    return res.json({});
  }
});

router.post("/bidWithdrawn", service_auth, async (req, res) => {
  try {
    let nftAddress = req.body.nftAddress;
    let tokenID = req.body.tokenID;
    let bidder = req.body.bidder;
    let bid = req.body.bid;
    nftAddress = toLowerCase(nftAddress);
    bidder = toLowerCase(bidder);
    bid = parseToFTM(bid);
    tokenID = parseInt(tokenID);
    // send mail
    let tk = await NFTITEM.findOne({
      tokenID: tokenID,
      contractAddress: nftAddress,
    });
    if (tk) {
      let address = tk.owner;
      let account = await Account.findOne({ address: address });
      if (account) {
        let to = account.email;
        let alias = account.alias;
        let collectionName = await getCollectionName(nftAddress);
        let tokenName = await get721ItemName(nftAddress, tokenID);
        let bidderAlias = await getUserAlias(bidder);
        let data = {
          type: "auction",
          to: to,
          event: "BidWithdrawn",
          subject: "You got a bid withdrawn for your item!",
          alias: alias,
          bidderAlias: bidderAlias,
          collectionName: collectionName,
          tokenName: tokenName,
          tokenID: tokenID,
          nftAddress: nftAddress,
          bid: bid,
        };
        sendEmail(data);
      }
    } else {
    }
    // remove bids
    try {
      nftAddress = toLowerCase(nftAddress);
      bidder = toLowerCase(bidder);
      await Bid.deleteMany({
        minter: nftAddress,
        tokenID: tokenID,
      });
    } catch (error) {}
  } catch (error) {
    return res.status(400).json({});
  } finally {
    return res.json({});
  }
});

router.post("/auctionResulted", service_auth, async (req, res) => {
  try {
    let nftAddress = req.body.nftAddress;
    let tokenID = req.body.tokenID;
    let winner = req.body.winner;
    let winningBid = req.body.winningBid;
    winningBid = parseToFTM(winningBid);
    nftAddress = toLowerCase(nftAddress);
    winner = toLowerCase(winner);
    tokenID = parseInt(tokenID);
    try {
      // send mail
      try {
        let account = await Account.findOne({ address: winner });
        if (account) {
          let to = account.email;
          let alias = account.alias;
          let collectionName = await getCollectionName(nftAddress);
          let tokenName = await get721ItemName(nftAddress, tokenID);
          let data = {
            type: "auction",
            to: to,
            event: "AuctionResulted",
            subject: "You won the NFT Item!",
            alias: alias,
            collectionName: collectionName,
            tokenName: tokenName,
            tokenID: tokenID,
            nftAddress: nftAddress,
            winningBid: winningBid,
          };
          sendEmail(data);
        }
      } catch (error) {}
      // update the last sale price
      let token = await NFTITEM.findOne({
        contractAddress: nftAddress,
        tokenID: tokenID,
      });
      if (token) {
        token.price = winningBid;
        token.lastSalePrice = winningBid;
        token.soldAt = new Date();
        // update sale ends at as well
        token.saleEndsAt = null;
        await token.save();
        try {
          let from = toLowerCase(token.owner);
          let history = new TradeHistory();
          history.collectionAddress = nftAddress;
          history.tokenID = tokenID;
          history.from = from;
          history.to = winner;
          history.price = winningBid;
          history.isAuction = true;
          await history.save();
        } catch (error) {}
      }

      try {
        await Auction.deleteMany({
          minter: nftAddress,
          tokenID: tokenID,
        });
      } catch (error) {}
      try {
        await Bid.deleteMany({
          minter: nftAddress,
          tokenID: tokenID,
        });
      } catch (error) {}
    } catch (error) {}
  } catch (error) {
    return res.status(400).json({});
  } finally {
    return res.json({});
  }
});

router.post("/auctionCancelled", service_auth, async (req, res) => {
  try {
    let nftAddress = req.body.nftAddress;
    let tokenID = req.body.tokenID;

    nftAddress = toLowerCase(nftAddress);
    tokenID = parseInt(tokenID);
    // first send email
    let bid = await Bid.findOne({
      minter: nftAddress,
      tokenID: tokenID,
    });
    if (bid) {
      let bidder = toLowerCase(bid.bidder);
      let account = await Account.findOne({ address: bidder });
      if (account) {
        let to = account.email;
        let alias = account.alias;
        let collectionName = await getCollectionName(nftAddress);
        let tokenName = await get721ItemName(nftAddress, tokenID);
        let data = {
          type: "auction",
          to: to,
          event: "AuctionCancelled",
          subject: "Auction cancelled!",
          alias: alias,
          collectionName: collectionName,
          tokenName: tokenName,
          tokenID: tokenID,
          nftAddress: nftAddress,
        };
        sendEmail(data);
      }
    }

    // update
    try {
      let tk = await NFTITEM.findOne({
        contractAddress: nftAddress,
        tokenID: tokenID,
      });
      if (tk) {
        tk.saleEndsAt = new null();
        await tk.save();
      }
    } catch (error) {}
    try {
      await Auction.deleteMany({
        minter: nftAddress,
        tokenID: tokenID,
      });
      await Bid.deleteMany({
        minter: nftAddress,
        tokenID: tokenID,
      });
    } catch (error) {}
  } catch (error) {
    return res.status(400).json({});
  } finally {
    return res.json({});
  }
});

module.exports = router;