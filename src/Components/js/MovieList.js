import React, { Component, Fragment } from 'react';
import axios from 'axios';
import openSocket from 'socket.io-client';
import levenshtein from 'js-levenshtein';
import Modal from 'react-responsive-modal';
import {
    FaExclamationTriangle, FaMagnet, FaPowerOff
} from 'react-icons/fa';

import '../css/MovieList.css';
import Cover from './Cover';
import Spinner from './Spinner';
import Details from './Details';
import TorrentList from './TorrentList';
import Plex from './Plex';
import Search from './Search';
import Beta from './Beta';
import Pager from './Pager';
import Order from '../../Data/Order';
import Pirate from './Pirate';

const searchCache = [];
const hashMapping = {};

class MovieList extends Component {

    constructor(props) {
        super(props);

        this.state = {
            error: null,
            isLoaded: false,
            movies: [],
            page: 1,
            modal: false,
            media: {},
            torrents: [],
            started: [],
            search: '',
            genre: '',
            order: '',
            type: 'movies',
            isSearching: false,
            status: null,
            width: 0,
            height: 0,
            scroll: 0,
            files: [],
        }

        // Clean up old faq flag
        window.localStorage.removeItem('popcornfaq');
        window.localStorage.removeItem('popcornfaq1');
        window.localStorage.removeItem('popcornfaq2');

        this.updateSearch = this.updateSearch.bind(this);
        this.getProgress = this.getProgress.bind(this);
        this.getTorrent = this.getTorrent.bind(this);
        this.updateWindowDimensions = this.updateWindowDimensions.bind(this);

        this.server = "https://" + window.location.hostname + ":9000";
    }
    
    componentDidMount() {
        // Get movie list
        this.updateData();

        // Update window size
        this.updateWindowDimensions();
        window.addEventListener('resize', this.updateWindowDimensions);

        // Update window scroll
        this.updateScroll();
        window.addEventListener('scroll', this.updateScroll);

        var socket = openSocket(this.server);
        socket.on('connect', data => {
            socket.emit('subscribe', 'torrents');
            socket.emit('subscribe', 'status');
            socket.emit('subscribe', 'files');
        });

        socket.on('torrents', data => {
            if (data) this.updateTorrents(data);
        });

        socket.on('status', data => {
            if (data) this.setState({status: data});
        });

        socket.on('files', data => {
            if (data) this.setState({files: data});
        });
    }
    
    componentWillUnmount() {
        window.removeEventListener('scroll', this.updateWindowDimensions);
        window.removeEventListener('resize', this.updateWindowDimensions);
    }

    updateWindowDimensions() {
        this.setState({ width: window.innerWidth, height: window.innerHeight });
    }

    updateScroll = () => {
        let scroll = (document.documentElement.scrollTop + document.body.scrollTop) / (document.documentElement.scrollHeight - document.documentElement.clientHeight);
        if (!isNaN(scroll)) this.setState({ scroll: scroll });
    }

    updateTorrents(data) {
        if (data.errno === "ECONNREFUSED") {
            this.setState({ error: { message: "Cannot access transmission" }});
        } else {
            var torrents = data.torrents || [];

            // Not sure if this is useful anymore?
            // if (this.state.docker) {
            //     torrents = torrents.filter(torrent => {
            //         return torrent.downloadDir.indexOf("/downloads") !== -1 || torrent.downloadDir.indexOf("/TV") !== -1;
            //     });
            // }

            torrents.map(torrent => {
                if (torrent.eta < 0 && hashMapping[torrent.hashString]) {
                    torrent.name = hashMapping[torrent.hashString];
                }
                return torrent;
            });

            const started = this.state.started.filter(hashString => {
                for (var i = 0; i < torrents.length; i++) {
                    if (torrents[i].hashString === hashString) return false;
                }
                return true;
            });

            var resetError = (this.state.error && this.state.error.message === "Cannot access transmission");

            this.setState({
                torrents: torrents,
                started: started,
                error: resetError ? null : this.state.error
            });
        }
    }

    updateSearch(search, genre, order, type, page) {
        this.setState({
            search: search,
            genre: genre,
            order: order,
            type: type,
            page: page || 1, // reset page if not provided
        }, () => this.updateData());
    }
    
    updateData() {
        const { page, genre, type } = this.state;

        // sanitize the search so that there are no special characters
        let search = this.state.search.replace(/[^\w\s]/gi, ' ');
        
        this.setState({isSearching: true});

        let order = this.state.order;
        if (type === 'movies') order = order || Order.movies[0].value;
        if (type === 'shows') order = order || Order.tv[0].value;
        if (type === 'animes') order = order || Order.anime[0].value;

        let ENDPOINT;
        
        if (type === 'animes') {
            const offset = (page - 1) * 20 + (page > 1 ? 1 : 0);
            const ordering = order === 'startDate' ? '-' : '';

            ENDPOINT = `https://kitsu.io/api/edge/anime?page[limit]=20&page[offset]=${offset}`;
            if (genre) ENDPOINT += `&filter[genres]=${genre}`;
            if (search.length > 0) {
                ENDPOINT += `&filter[text]=${search}`;
            } else {
                ENDPOINT += `&sort=${ordering}${order || Order.anime[0].value}`;
            }
        } else if (type === 'pirate') {
            if (search.length === 0) {
                this.setState({movies: [], isSearching: false});
                return;
            }
            // use all so that we do not filter here
            ENDPOINT = `${this.server}/pirate/${search}?all=true`;
        } else {
            if (search.length > 0) {
                ENDPOINT = `${this.server}/search/${type}/${page}?query=${search}`;
            } else {
                ENDPOINT = `${this.server}/discover/${type}/${page}?sort=${order}`;
                if (genre) ENDPOINT += `&genre=${genre}`;
            }
        }

        if (searchCache[ENDPOINT]) {
            this.handleData(searchCache[ENDPOINT]);
        } else {
            axios.get(ENDPOINT).then(response => {
                searchCache[ENDPOINT] = response.data;
                this.handleData(response.data);
            }).catch(error => {
                console.error(error);
                this.setState({
                    error: error,
                    isLoaded: true,
                    isSearching: false,
                });
            });
        }
    }

    handleData(data) {
        const { search, type } = this.state;
        
        if (type === 'pirate') {
            this.setState({
                movies: data,
                isLoaded: true,
                isSearching: false
            });

            return;
        }

        if (data.data) data.results = data.data;

        if (data.results && data.results.map) {
            data = data.results.map(media => {
                // used for anime
                const attributes = media.attributes;
                if (attributes) {
                    media.title = attributes.canonicalTitle;
                    media.year = attributes.startDate;
                    if (attributes.posterImage) media.poster_path = attributes.posterImage.small;
                }
                
                // fix weird years (since it seems the year can vary based on region released first)
                media.year = media.year || media.release_date || media.first_air_date;

                // only try to do fancy stuff if not a standard year
                if (media.year && !media.year.toString().match(/^\d{4}$/)) media.year = new Date(media.year).getFullYear();

                media.title = media.title || media.name || '?';
                media.title = media.title.replace(/&amp;/g, '&');
                
                // TMDB does not add an absolute url to returned poster paths
                if (media.poster_path && media.poster_path.indexOf('http') === -1) {
                    media.poster_path = 'https://image.tmdb.org/t/p/w300_and_h450_bestv2/' + media.poster_path;
                }

                // Fake tv data
                if (type !== 'movies') media.num_seasons = 1;

                return media;
            });
            
            // The search filtering is not great for kitsu :(
                if (type === 'animes' && search.length > 0) {
                    data = data.filter(media => {
                    const lev = levenshtein(search.toLowerCase(), media.title.toLowerCase());
                    const match = (1 - (lev / Math.max(search.length, media.title.length)));
                    return match > 0.75 || media.title.toLowerCase().startsWith(search.toLowerCase());
                });
            }
    
            this.setState({
                movies: data,
                isLoaded: true,
                isSearching: false
            });
        } else {
            this.setState({
                isLoaded: true,
                isSearching: false
            });
        }
    }

    cancelTorrent = (hashString) => {
        axios.delete(this.server + '/torrents/' + hashString).catch(error => {
            console.error(error);
        });
    }

    downloadTorrent = (version) => {
        this.setState({
            started: [ ...this.state.started, version.hashString ]
        });

        hashMapping[version.hashString] = version.title;

        // fix dead links
        let url = version.url;
        if (url.indexOf('nyaa.se') !== -1) url = url.replace('nyaa.se', 'nyaa.si').replace('?page=download', 'download/').replace('&tid=', '') + '.torrent';

        axios.post(this.server + '/torrents', { url: url, tv: version.tv }).catch(error => {
            console.error(error);

            // Reset started state if download failed
            this.setState({
                started: this.state.started.filter(item => item !== version.hashString)
            });
        });

        // this.torrentList.expand();
    }

    addMagnet = () => {
        var url = window.prompt("Url or magnet?", "");

        if (url && url.length > 0) {
            var tv = window.confirm("Is this a tv show?");
    
            axios.post(this.server + '/torrents', { url: url, tv: tv }).catch(error => {
                console.error(error);
            });
        }
    }

    upgrade = () => {
        var password = window.prompt("Password?", "");
        axios.post(this.server + '/upgrade?upgradeKey=' + password).then(response => {
            console.log(response.data);
            alert('Starting upgrade');
        }).catch(err => {
            console.error(err);
            alert('Something went wrong...')
        });
    }

    getTorrent(hashString) {
        for (var i = 0; i < this.state.torrents.length; i++) {
            const torrent = this.state.torrents[i];
            if (torrent.hashString === hashString) return torrent;
        }

        return null;
    }
    
    getProgress(hashString) {
        const torrent = this.getTorrent(hashString);
        return (torrent !== null) ? (torrent.percentDone * 100).toFixed(0) : null;
    }

    onOpenModal = (media) => {
        this.setState({ media: media, modal: true });
    };

    onCloseModal = () => {
        this.setState({ modal: false });
    };

    changePage = (direction) => {
        const page= this.state.page;
        var newPage = direction + page;
        if (page === newPage) return;
        if (newPage < 1) newPage = 1;

        this.setState({ page: newPage }, () => this.updateData());
    }

    render() {
        const { error, isLoaded, movies, modal, media, page, torrents, started, width, status, scroll, type } = this.state;

        const pagerVisibility = page !== 1 || movies.length >= 20;
        const floatingPagerVisibility = (scroll < 0.97 && pagerVisibility);

        if (error) {
            return (
                <div className="message">
                    {(error.message !== "Cannot access transmission") ? (
                        <Fragment>
                            <br/>
                            <button onClick={() => document.location.reload()}>Reload Page</button>
                        </Fragment>
                    ) : <span>Error: {error.message}</span>}
                </div>
            );
        } else if (!isLoaded) {
            return (
            <div className="message">
                <span>Loading...
                    <Spinner visible/>
                </span>
            </div>
            );
        } else {
            return (
                <Fragment>
                    {status ? <Plex plexServer={status.plex}/> : null}
                    {(this.state.type === "shows" || this.state.type === "animes") ? <Beta/> : null}

                    <Modal open={modal} onClose={this.onCloseModal} center={width > 800} modalId='modal'>
                        <Details
                            media={media}
                            type={type}
                            server={this.server}
                            torrents={torrents}
                            started={started}
                            updateTorrents={this.updateTorrents}
                            cancelTorrent={this.cancelTorrent}
                            downloadTorrent={this.downloadTorrent}
                            getProgress={this.getProgress}
                            getTorrent={this.getTorrent}
                        />
                    </Modal>
            
                    {status && (status.ip.city === "Seattle") ? (
                        <div className="warning red">
                            <div>
                                <FaExclamationTriangle className="big"/>
                                <span className="big">Server not secure</span>
                            </div>
                            <span>(Don't worry, your activity is still encrypted and untraceable. This is an admin message for Andrew)</span>
                        </div>
                    ) : null}

                    <TorrentList
                        torrents={torrents}
                        cancelTorrent={this.cancelTorrent}
                        getLink={this.getLink}
                        getProgress={this.getProgress}
                        ref={instance => { this.torrentList = instance; }}
                    />

                    <Search
                        updateSearch={this.updateSearch}
                        isSearching={this.state.isSearching}
                        search={this.state.search}
                        genre={this.state.genre}
                        quality={this.state.quality}
                        order={this.state.order}
                        type={this.state.type}
                        page={this.state.page}
                    />

                    <div className="movie-list">
                        {(movies && movies.length > 0) ? (
                            type === 'pirate' ? (
                                <div className="pirateList">
                                    {movies.map(media => (
                                        <Pirate
                                            key={media.name || media.id}
                                            media={media}
                                            started={started}
                                            downloadTorrent={this.downloadTorrent}
                                            cancelTorrent={this.cancelTorrent}
                                            getLink={this.getLink}
                                            getProgress={this.getProgress}
                                            getTorrent={this.getTorrent}
                                        />
                                    ))}
                                </div>
                            ) : (
                                movies.map(media => (
                                    <Cover
                                        key={media.id}
                                        media={media}
                                        type={type}
                                        click={this.onOpenModal}
                                        downloadTorrent={this.downloadTorrent}
                                        cancelTorrent={this.cancelTorrent}
                                        torrents={this.torrents}
                                        started={started}
                                        getProgress={this.getProgress}
                                        server={this.server}
                                        files={this.state.type === "movies" ? this.state.files : []} // only show downloaded files for movies
                                    />
                            ))
                        )) : type !== 'pirate' ? <h1>No Results</h1> : <h2>Please enter a search term</h2>
                        }
                    </div>

                    {type !== 'pirate' ? (
                        <Fragment>
                            <Pager changePage={this.changePage} page={page} media={movies}
                                type={"floating " + (floatingPagerVisibility ? "" : "hidden")}/>
        
                            <Pager changePage={this.changePage} page={page} media={movies}
                                type={pagerVisibility ? "" : "hidden"}/>
                        </Fragment>
                    ) : null}

                    <FaMagnet className="pointer" onClick={this.addMagnet}/>
                    <FaPowerOff className="pointer marginLeft" onClick={this.upgrade}/>

                    <div className="footer">
                        {status ? (
                            <Fragment>
                                <hr/>

                                <p>Server Location: {`${status.ip.city}, ${status.ip.country_name}`}</p>
                                {(status.buildTime && status.buildTime.indexOf('Dev Build') === -1) ? (
                                    <p><span>Build Time: {new Date(status.buildTime).toLocaleString()}</span></p>
                                ) : null}
                                <p>
                                    <span>Disk Usage: {parseFloat(status.storageUsage).toFixed(1)}%</span>
                                    <progress value={status.storageUsage} max="100"/>
                                </p>
                                <p>
                                    <span>Cache Size: {status.cacheUsage}</span>
                                </p>
                            </Fragment>
                        ) : null}
                    </div>
                </Fragment>
            );
        }
    }
}

export default MovieList;